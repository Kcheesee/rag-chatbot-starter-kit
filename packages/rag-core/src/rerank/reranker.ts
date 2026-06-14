/**
 * Rerankers.
 *
 * Initial retrieval casts wide (top-K); the reranker refines to top-N before
 * generation. The default `HybridReranker` is dependency-free: it blends the vector
 * similarity with lexical query-term coverage, which catches the common case where
 * the closest embedding isn't the best literal answer. For a true cross-encoder, the
 * opt-in `CohereReranker` calls Cohere's rerank API. Both keep scores in [0, 1].
 */

import type { SearchResult } from "@rag-chat-agent/vector-adapters";

import type { Reranker } from "../types";
import type { Env } from "../env";

/** Lowercase alphanumeric term set. */
function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

/** Fraction of the query's terms that appear in `text`, in [0, 1]. */
function lexicalCoverage(queryTerms: Set<string>, text: string): number {
  if (queryTerms.size === 0) return 0;
  const textTerms = tokenize(text);
  let hits = 0;
  for (const term of queryTerms) if (textTerms.has(term)) hits += 1;
  return hits / queryTerms.size;
}

/** Default reranker: blends vector similarity with lexical coverage. */
export class HybridReranker implements Reranker {
  constructor(private readonly vectorWeight = 0.7) {}

  async rerank(query: string, results: SearchResult[], topN: number): Promise<SearchResult[]> {
    const queryTerms = tokenize(query);
    const rescored = results.map((result) => {
      const coverage = lexicalCoverage(queryTerms, result.text);
      const blended = this.vectorWeight * result.score + (1 - this.vectorWeight) * coverage;
      return { ...result, score: Math.max(0, Math.min(1, blended)) };
    });
    rescored.sort((a, b) => b.score - a.score);
    return rescored.slice(0, topN);
  }
}

interface CohereRerankResponse {
  results: Array<{ index: number; relevance_score: number }>;
}

/** Opt-in cross-encoder reranker backed by Cohere's rerank API. */
export class CohereReranker implements Reranker {
  constructor(
    private readonly apiKey: string,
    private readonly model = "rerank-english-v3.0",
  ) {}

  async rerank(query: string, results: SearchResult[], topN: number): Promise<SearchResult[]> {
    if (results.length === 0) return [];
    const res = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        query,
        documents: results.map((r) => r.text),
        top_n: topN,
      }),
    });
    if (!res.ok) {
      throw new Error(`Cohere rerank failed: ${res.status} ${res.statusText}. See CONFIG.md#rerank.`);
    }
    const json = (await res.json()) as CohereRerankResponse;
    return json.results
      .map((r) => {
        const original = results[r.index];
        return original ? { ...original, score: r.relevance_score } : undefined;
      })
      .filter((r): r is SearchResult => r !== undefined)
      .slice(0, topN);
  }
}

/** Build the default reranker. (Swap in `CohereReranker` directly for a cross-encoder.) */
export function createReranker(_env: Env): Reranker {
  return new HybridReranker();
}
