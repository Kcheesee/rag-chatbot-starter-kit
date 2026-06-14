/** Shared span-replacement logic for all PII redactors. */

import type { PIIEntity, RedactedText } from "../types";

/** A detected PII span, in character offsets against the original text. */
export interface PIISpan {
  start: number;
  end: number;
  type: PIIEntity;
}

/**
 * Replace each detected span with a labelled placeholder (`[REDACTED_SSN]`).
 *
 * Spans are applied right-to-left so each splice leaves the offsets of
 * not-yet-applied (earlier) spans valid. Assumes non-overlapping spans, which both
 * Presidio and Comprehend produce.
 */
export function applySpans(text: string, spans: PIISpan[]): RedactedText {
  const n = text.length;
  const ordered = [...spans].sort((a, b) => b.start - a.start);
  const counts = new Map<PIIEntity, number>();
  let out = text;

  for (const span of ordered) {
    if (span.start < 0 || span.end > n || span.start >= span.end) continue;
    out = `${out.slice(0, span.start)}[REDACTED_${span.type}]${out.slice(span.end)}`;
    counts.set(span.type, (counts.get(span.type) ?? 0) + 1);
  }

  return {
    text: out,
    entitiesFound: [...counts.entries()].map(([type, count]) => ({ type, count })),
  };
}
