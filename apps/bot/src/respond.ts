/**
 * Shared bot logic: query the RAG pipeline and shape the result for a chat platform.
 *
 * Both the Slack and Teams adapters call `answerQuestion` — they only differ in how
 * they receive messages and render the answer + citations. The pipeline is built
 * once per process from validated env.
 */

import { createPipeline, loadEnv, type Citation, type RAGPipeline } from "@rag-chat-agent/rag-core";

let pipeline: RAGPipeline | null = null;
function getPipeline(): RAGPipeline {
  if (!pipeline) pipeline = createPipeline(loadEnv());
  return pipeline;
}

/** Namespace bots query. Override per-deployment if you partition by team/tenant. */
export const NAMESPACE = "default";

export interface BotAnswer {
  text: string;
  citations: Citation[];
  /** True when the query hit the low-confidence fallback (flag for human handoff). */
  escalated: boolean;
}

/** Run one question through the pipeline. `sessionId` is the per-thread window. */
export async function answerQuestion(query: string, sessionId: string): Promise<BotAnswer> {
  const res = await getPipeline().query({ query, sessionId, namespace: NAMESPACE });
  return { text: res.answer, citations: res.sources, escalated: res.escalate };
}

/** Compact plain-text citation list, for platforms without rich blocks. */
export function formatCitations(citations: Citation[]): string {
  if (citations.length === 0) return "";
  const lines = citations.map(
    (c) => `  [${c.index}] ${c.sourceFile}${c.pageNumber !== undefined ? `, p.${c.pageNumber}` : ""}`,
  );
  return `\n\nSources:\n${lines.join("\n")}`;
}
