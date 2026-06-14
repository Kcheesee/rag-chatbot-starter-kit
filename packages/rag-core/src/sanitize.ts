/**
 * Input sanitisation — the pipeline's first guardrail stage.
 *
 * This is defence-in-depth, not the primary defence: the real protection is that
 * the system prompt is server-assembled and the hard rules sit between the persona
 * and the (untrusted) context so user text can't override them. Here we additionally
 * neutralise the most common injection directives in the *query* and flag the
 * attempt so the pipeline can emit a security audit event.
 */

/** Patterns that look like attempts to override instructions or exfiltrate the prompt. */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(?:all\s+|the\s+|any\s+|your\s+)*(?:previous|prior|above|preceding)\s+(?:instructions?|prompts?|rules?)/i,
  /disregard\s+(?:all\s+|the\s+|your\s+)*(?:previous|prior|above)\s+(?:instructions?|prompts?|rules?)/i,
  /(?:reveal|show|print|repeat|output)\s+(?:me\s+)?(?:your\s+|the\s+)?(?:system\s+)?(?:prompt|instructions?|rules?)/i,
  /you\s+are\s+now\s+(?:a|an|the)\b/i,
  /(?:forget|override)\s+(?:everything|all|your\s+instructions?)/i,
  /\bDAN\b|\bjailbreak\b/i,
];

export interface SanitizedInput {
  /** The cleaned query to use downstream. */
  text: string;
  /** True when an injection-like pattern was detected (log a security event). */
  injectionSuspected: boolean;
}

/**
 * Clean and screen a user query. Strips control characters (keeping tab/newline),
 * collapses runs of spaces, then flags and removes lines matching known injection
 * directives. The remaining query text is preserved so legitimate questions are
 * unaffected.
 */
export function sanitizeInput(raw: string): SanitizedInput {
  const normalised = raw
    // Drop control characters except tab (\x09) and newline (\x0A).
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

  let injectionSuspected = false;
  const cleanedLines = normalised.split("\n").filter((line) => {
    if (INJECTION_PATTERNS.some((pattern) => pattern.test(line))) {
      injectionSuspected = true;
      return false; // strip the offending line
    }
    return true;
  });

  return { text: cleanedLines.join("\n").trim(), injectionSuspected };
}
