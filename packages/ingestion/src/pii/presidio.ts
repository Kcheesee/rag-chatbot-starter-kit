/**
 * Microsoft Presidio redactor (local / open-source).
 *
 * Calls the Presidio Analyzer to locate PII spans, then replaces them locally with
 * labelled placeholders. Local analysis keeps content inside the deployment
 * boundary — appropriate when data must not leave the environment.
 */

import type { PIIRedactor, RedactedText, PIIEntity } from "../types";
import { applySpans, type PIISpan } from "./apply";

/** Presidio analyzer entity types → our placeholder categories. */
const PRESIDIO_TO_ENTITY: Record<string, PIIEntity> = {
  PERSON: "PERSON",
  EMAIL_ADDRESS: "EMAIL_ADDRESS",
  PHONE_NUMBER: "PHONE_NUMBER",
  US_SSN: "SSN",
  CREDIT_CARD: "CREDIT_CARD",
  LOCATION: "STREET_ADDRESS",
  DATE_TIME: "DATE_OF_BIRTH",
};

interface PresidioResult {
  entity_type: string;
  start: number;
  end: number;
  score: number;
}

export class PresidioRedactor implements PIIRedactor {
  readonly provider = "presidio";

  /**
   * @param url - Base URL of the Presidio analyzer.
   * @param minConfidence - Drop detections whose analyzer `score` is below this [0,1]
   *   threshold. Defaults to 0 (redact everything Presidio flags); raise it to suppress
   *   low-confidence false positives at the cost of recall.
   */
  constructor(
    private readonly url: string,
    private readonly minConfidence: number = 0,
  ) {}

  async redact(text: string): Promise<RedactedText> {
    const res = await fetch(`${this.url.replace(/\/$/, "")}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        language: "en",
        entities: Object.keys(PRESIDIO_TO_ENTITY),
      }),
    });
    if (!res.ok) {
      throw new Error(
        `Presidio analyze failed: ${res.status} ${res.statusText}. ` +
          `Is the analyzer reachable at PRESIDIO_URL? See CONFIG.md#pii-redaction.`,
      );
    }

    const results = (await res.json()) as PresidioResult[];
    const spans: PIISpan[] = [];
    for (const r of results) {
      // Skip detections the analyzer isn't confident enough about — a low-score false
      // positive would redact (and corrupt) legitimate text.
      if (r.score < this.minConfidence) continue;
      const type = PRESIDIO_TO_ENTITY[r.entity_type];
      if (type) spans.push({ start: r.start, end: r.end, type });
    }
    return applySpans(text, spans);
  }
}
