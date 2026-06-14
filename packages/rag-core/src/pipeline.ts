/**
 * The RAG pipeline — the heart of the system.
 *
 * `stream()` runs all 16 stages and yields tokens as they generate; `query()` is a
 * thin accumulator over `stream()` so there is exactly one implementation of the
 * pipeline. Guardrails are first-class stages, not afterthoughts:
 *
 *   1  sanitise input          9  build context (+ token budget)
 *   2  load session history    10 generate (streamed)
 *   3  query rewrite (opt)     11 validate citations
 *   4  embed query             12 faithfulness check (opt)
 *   5  cache check + grounding 13 store in cache (with source hashes)
 *   6  retrieve (top-K)        14 append to session
 *   7  confidence gate         15 audit
 *   8  rerank (top-N)          16 return
 *
 * The confidence gate (7) returns a fallback WITHOUT calling the LLM — when nothing
 * relevant was retrieved, generating would only invite hallucination.
 */

import type { AuditLogger, DeploymentMode } from "@rag-chat-agent/audit-logger";
import { hashText } from "@rag-chat-agent/audit-logger";
import type { ChatMessage, EmbeddingAdapter, LLMAdapter } from "@rag-chat-agent/llm-adapters";
import type { SearchResult, VectorAdapter } from "@rag-chat-agent/vector-adapters";

import type {
  Citation,
  QueryInput,
  RAGPipeline,
  RAGResponse,
  Reranker,
  ResponseCache,
  SessionStore,
  StreamChunk,
} from "./types";
import { sanitizeInput } from "./sanitize";
import { validateCacheGrounding } from "./cache/grounding";
import {
  FALLBACK_ANSWER,
  buildCitations,
  buildSystemPrompt,
  extractCitedIndices,
  formatContext,
} from "./prompt";
import { estimateTokens } from "./tokens";

/** Collaborators the pipeline orchestrates. */
export interface PipelineDeps {
  llm: LLMAdapter;
  embedder: EmbeddingAdapter;
  vectorStore: VectorAdapter;
  cache: ResponseCache;
  sessionStore: SessionStore;
  reranker: Reranker;
  audit: AuditLogger;
}

/** Pipeline behaviour, derived from validated env. */
export interface PipelineConfig {
  persona: string;
  topK: number;
  topN: number;
  minConfidence: number;
  maxContextTokens: number;
  queryRewrite: boolean;
  /**
   * When true, a generated answer with zero valid citations is escalated rather than
   * served as authoritative. Pair with FAITHFULNESS_CHECK for high-stakes / regulated
   * deployments where an ungrounded answer is worse than no answer.
   */
  strictGrounding: boolean;
  faithfulnessCheck: boolean;
  faithfulnessThreshold: number;
  cacheEnabled: boolean;
  logQueryHashes: boolean;
  environment: string;
  deploymentMode: DeploymentMode;
  maxTokens: number;
  temperature: number;
  model: string;
}

const nowIso = (): string => new Date().toISOString();

export class RAGPipelineImpl implements RAGPipeline {
  constructor(
    private readonly deps: PipelineDeps,
    private readonly config: PipelineConfig,
  ) {}

  /** Run the pipeline and return the assembled response. */
  async query(input: QueryInput): Promise<RAGResponse> {
    let response: RAGResponse | null = null;
    for await (const chunk of this.stream(input)) {
      if (chunk.type === "done") response = chunk.response;
      else if (chunk.type === "error") throw new Error(chunk.error);
    }
    if (response === null) throw new Error("Pipeline produced no response.");
    return response;
  }

  /** Run the pipeline, streaming tokens then a terminal response. */
  async *stream(input: QueryInput): AsyncGenerator<StreamChunk, void, unknown> {
    const started = Date.now();
    try {
      // 1. Sanitise input.
      const { text: query, injectionSuspected } = sanitizeInput(input.query);
      if (injectionSuspected) {
        this.logSecurity(input, started, "Query matched a prompt-injection pattern.");
      }

      // 2. Load session history.
      const history = await this.deps.sessionStore.getHistory(input.sessionId);

      // 3. Query rewrite (optional).
      const effectiveQuery = this.config.queryRewrite
        ? await this.rewriteQuery(query, history)
        : query;

      // 4. Embed the query.
      const embedding = await this.deps.embedder.embedOne(effectiveQuery);
      const store = this.deps.vectorStore.namespace(input.namespace);

      // 5. Cache check + grounding.
      if (this.config.cacheEnabled) {
        const hit = await this.deps.cache.get(embedding, input.namespace);
        if (hit) {
          if (await validateCacheGrounding(hit, store)) {
            this.logCache(input, started, "hit");
            yield* this.emitCached(input, started, query, hit);
            return;
          }
          // Source content changed since caching — drop the stale entry.
          this.logCache(input, started, "grounding_failed");
          await this.deps.cache.invalidate(input.namespace);
        }
      }

      // 6. Retrieve.
      const retrieved = await store.search(embedding, this.config.topK);

      // 7. Confidence gate — fall back WITHOUT an LLM call when nothing is relevant.
      const confidence = retrieved.reduce((max, r) => Math.max(max, r.score), 0);
      if (confidence < this.config.minConfidence) {
        yield* this.emitFallback(input, started, query, confidence);
        return;
      }

      // 8. Rerank to top-N.
      const reranked = await this.deps.reranker.rerank(effectiveQuery, retrieved, this.config.topN);

      // 9. Build the context window (token-budget enforced).
      const { systemPrompt, citations, messages } = this.buildContext(query, history, reranked);

      // 10. Generate (streamed).
      let answer = "";
      for await (const token of this.deps.llm.stream(messages, {
        system: systemPrompt,
        maxTokens: this.config.maxTokens,
        temperature: this.config.temperature,
        ...(input.signal ? { signal: input.signal } : {}),
      })) {
        answer += token;
        yield { type: "token", token };
      }

      // 11. Validate citations — keep only [N] markers that map to a provided chunk.
      const cited = new Set(extractCitedIndices(answer));
      const sources = citations.filter((c) => cited.has(c.index));

      // Accuracy guardrails FAIL CLOSED: an answer with no grounded citation, or one
      // the faithfulness check can't confirm, is escalated rather than served as
      // authoritative. The streamed tokens already reached the client, so escalation
      // is a signal the surface acts on (badge / route / suppress), not a silent pass.
      let escalate = false;
      let escalateReason: string | undefined;
      if (this.config.strictGrounding && sources.length === 0) {
        escalate = true;
        escalateReason = "no_grounded_citations";
      }

      // 12. Faithfulness check (optional). An UNPARSEABLE score escalates — it is never
      // treated as "fully faithful" (the previous fail-open behaviour).
      let faithfulness: number | undefined;
      if (this.config.faithfulnessCheck) {
        const score = await this.scoreFaithfulness(answer, reranked);
        if (score === null) {
          escalate = true;
          escalateReason ??= "faithfulness_unparseable";
        } else {
          faithfulness = score;
          if (score < this.config.faithfulnessThreshold) {
            escalate = true;
            escalateReason ??= "faithfulness_below_threshold";
          }
        }
      }

      const response: RAGResponse = {
        answer,
        sources,
        confidence,
        fromCache: false,
        escalate,
        ...(escalateReason ? { escalateReason } : {}),
        latencyMs: Date.now() - started,
        model: this.config.model,
      };

      // 13. Store in cache (with source ids + hashes for the grounding check).
      if (this.config.cacheEnabled) {
        await this.deps.cache.set(embedding, input.namespace, {
          answer,
          sources,
          sourceChunks: reranked.map((r) => ({ chunkId: r.id, contentHash: r.contentHash })),
          model: this.config.model,
          createdAt: nowIso(),
        });
      }

      // 14. Append to session.
      await this.appendTurns(input.sessionId, query, answer);

      // 15. Audit.
      this.logQueryEvent(input, response, query, faithfulness);

      // 16. Return.
      yield { type: "sources", sources };
      yield { type: "done", response };
    } catch (err) {
      yield { type: "error", error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ── Cache-hit and fallback short-circuits ─────────────────────────────────

  private async *emitCached(
    input: QueryInput,
    started: number,
    query: string,
    hit: { answer: string; sources: Citation[] },
  ): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: "token", token: hit.answer };
    const response: RAGResponse = {
      answer: hit.answer,
      sources: hit.sources,
      confidence: 1,
      fromCache: true,
      escalate: false,
      latencyMs: Date.now() - started,
      model: this.config.model,
    };
    await this.appendTurns(input.sessionId, query, hit.answer);
    this.logQueryEvent(input, response, query, undefined);
    yield { type: "sources", sources: hit.sources };
    yield { type: "done", response };
  }

  private async *emitFallback(
    input: QueryInput,
    started: number,
    query: string,
    confidence: number,
  ): AsyncGenerator<StreamChunk, void, unknown> {
    yield { type: "token", token: FALLBACK_ANSWER };
    const response: RAGResponse = {
      answer: FALLBACK_ANSWER,
      sources: [],
      confidence,
      fromCache: false,
      escalate: true, // flag for human handoff
      latencyMs: Date.now() - started,
      model: this.config.model,
    };
    await this.appendTurns(input.sessionId, query, FALLBACK_ANSWER);
    this.logQueryEvent(input, response, query, undefined);
    yield { type: "sources", sources: [] };
    yield { type: "done", response };
  }

  // ── Stage helpers ─────────────────────────────────────────────────────────

  /** Rewrite a query into a standalone form using recent history (stage 3). */
  private async rewriteQuery(query: string, history: { content: string }[]): Promise<string> {
    const recent = history
      .slice(-4)
      .map((t) => t.content)
      .join("\n");
    const res = await this.deps.llm.chat(
      [
        {
          role: "user",
          content:
            "Rewrite the user's question to be fully self-contained, resolving any " +
            "references to earlier turns. Reply with ONLY the rewritten question.\n\n" +
            `Recent context:\n${recent}\n\nQuestion: ${query}`,
        },
      ],
      { maxTokens: 256, temperature: 0 },
    );
    const rewritten = res.content.trim();
    return rewritten.length > 0 ? rewritten : query;
  }

  /**
   * Assemble the locked system prompt + bounded message history (stage 9), trimming
   * to the token budget: drop oldest history first, then lowest-score chunks — never
   * truncate mid-chunk.
   */
  private buildContext(
    query: string,
    history: ChatMessage[] | { role: "user" | "assistant"; content: string }[],
    chunks: SearchResult[],
  ): { systemPrompt: string; citations: Citation[]; messages: ChatMessage[] } {
    let turns: ChatMessage[] = history.map((t) => ({ role: t.role, content: t.content }));
    let used = chunks;

    const assemble = (): { systemPrompt: string; messages: ChatMessage[]; tokens: number } => {
      const systemPrompt = buildSystemPrompt(this.config.persona, used);
      const messages: ChatMessage[] = [...turns, { role: "user", content: query }];
      const tokens =
        estimateTokens(systemPrompt) +
        messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
      return { systemPrompt, messages, tokens };
    };

    let current = assemble();
    // First lever: drop the oldest history turns.
    while (current.tokens > this.config.maxContextTokens && turns.length > 0) {
      turns = turns.slice(1);
      current = assemble();
    }
    // Second lever: drop the lowest-ranked chunk (chunks are sorted best-first).
    while (current.tokens > this.config.maxContextTokens && used.length > 1) {
      used = used.slice(0, -1);
      current = assemble();
    }

    return {
      systemPrompt: current.systemPrompt,
      citations: buildCitations(used),
      messages: current.messages,
    };
  }

  /**
   * Score how well the answer is supported by the context (stage 12).
   *
   * Returns `null` when the model's reply can't be parsed into a number — the caller
   * treats that as "could not confirm" and escalates, rather than assuming faithful.
   */
  private async scoreFaithfulness(answer: string, chunks: SearchResult[]): Promise<number | null> {
    const res = await this.deps.llm.chat(
      [
        {
          role: "user",
          content:
            `Context:\n${formatContext(chunks)}\n\nAnswer:\n${answer}\n\n` +
            "On a scale from 0 to 1, how fully is the Answer supported by the Context? " +
            "Reply with only the number.",
        },
      ],
      { maxTokens: 8, temperature: 0 },
    );
    const score = Number.parseFloat(res.content.trim());
    // Unparseable → null ("could not confirm"), never 1. The caller escalates.
    return Number.isFinite(score) ? Math.max(0, Math.min(1, score)) : null;
  }

  private async appendTurns(sessionId: string, query: string, answer: string): Promise<void> {
    const timestamp = nowIso();
    await this.deps.sessionStore.append(sessionId, { role: "user", content: query, timestamp });
    await this.deps.sessionStore.append(sessionId, { role: "assistant", content: answer, timestamp });
  }

  // ── Audit helpers ─────────────────────────────────────────────────────────

  private logQueryEvent(
    input: QueryInput,
    response: RAGResponse,
    query: string,
    faithfulness: number | undefined,
  ): void {
    this.deps.audit.logQuery({
      timestamp: nowIso(),
      event_type: "query",
      session_id: input.sessionId,
      ...(input.userId ? { user_id: input.userId } : {}),
      latency_ms: response.latencyMs ?? 0,
      environment: this.config.environment,
      deployment_mode: this.config.deploymentMode,
      ...(this.config.logQueryHashes ? { query_hash: hashText(query) } : {}),
      namespace: input.namespace,
      retrieval_confidence: response.confidence,
      from_cache: response.fromCache,
      escalated: response.escalate,
      source_count: response.sources.length,
      ...(response.model ? { model: response.model } : {}),
      ...(faithfulness !== undefined ? { faithfulness_score: faithfulness } : {}),
    });
  }

  private logCache(input: QueryInput, started: number, action: "hit" | "grounding_failed"): void {
    this.deps.audit.logCacheEvent({
      timestamp: nowIso(),
      event_type: "cache",
      session_id: input.sessionId,
      ...(input.userId ? { user_id: input.userId } : {}),
      latency_ms: Date.now() - started,
      environment: this.config.environment,
      deployment_mode: this.config.deploymentMode,
      namespace: input.namespace,
      action,
    });
  }

  private logSecurity(input: QueryInput, started: number, detail: string): void {
    this.deps.audit.logSecurityEvent({
      timestamp: nowIso(),
      event_type: "security",
      session_id: input.sessionId,
      ...(input.userId ? { user_id: input.userId } : {}),
      latency_ms: Date.now() - started,
      environment: this.config.environment,
      deployment_mode: this.config.deploymentMode,
      category: "prompt_injection_suspected",
      detail,
    });
  }
}
