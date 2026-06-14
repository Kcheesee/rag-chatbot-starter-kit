/** Content hashing for chunks — drives the response cache's grounding check. */

import { createHash } from "node:crypto";

/** Lowercase hex sha256 of `text`. */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
