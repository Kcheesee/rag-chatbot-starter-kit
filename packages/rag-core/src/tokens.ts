/**
 * Token estimation for the pipeline's context-budget stage.
 *
 * Deliberately a local copy of the ~4-chars/token heuristic (also used by the
 * ingestion chunker): `ingestion` depends on `rag-core`, so importing it back would
 * create a cycle. The estimate doesn't need to be exact — it gates when history and
 * chunks get trimmed, where being approximately right is sufficient.
 */

const CHARS_PER_TOKEN = 4;

/** Approximate token count of `text`. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
