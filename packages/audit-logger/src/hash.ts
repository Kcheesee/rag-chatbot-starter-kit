/**
 * Hashing helper for audit records.
 *
 * Raw query text is never logged. When LOG_QUERY_HASHES is on, the pipeline logs
 * `sha256(query)` instead — enough to detect repeated/abusive queries and to
 * correlate events without ever persisting what the user actually asked.
 */

import { createHash } from "node:crypto";

/** Return the lowercase hex sha256 of `text`. */
export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
