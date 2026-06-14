/**
 * AWS Comprehend PII redactor (GovCloud-compatible).
 *
 * Uses DetectPiiEntities to locate PII, then replaces spans locally. Credentials
 * resolve from the default AWS provider chain (IAM role), never a static key — the
 * same posture as the Bedrock adapters, so it works inside a GovCloud boundary.
 */

import type { ComprehendClient } from "@aws-sdk/client-comprehend";

import type { PIIRedactor, RedactedText, PIIEntity } from "../types";
import { applySpans, type PIISpan } from "./apply";

/** Comprehend PII entity types → our placeholder categories. */
const COMPREHEND_TO_ENTITY: Record<string, PIIEntity> = {
  NAME: "PERSON",
  EMAIL: "EMAIL_ADDRESS",
  PHONE: "PHONE_NUMBER",
  SSN: "SSN",
  ADDRESS: "STREET_ADDRESS",
  CREDIT_DEBIT_NUMBER: "CREDIT_CARD",
  DATE_TIME: "DATE_OF_BIRTH",
};

// DetectPiiEntities caps at 5000 UTF-8 bytes; window well under that on chars.
// Windows OVERLAP so an entity straddling a window boundary is still fully contained
// in (and detected by) the next window — without overlap, a boundary-split SSN or
// address would be seen as two truncated fragments and silently pass unredacted.
// OVERLAP must exceed the longest PII entity (addresses are the longest, ~<256).
const WINDOW_CHARS = 4000;
const WINDOW_OVERLAP = 256;
const WINDOW_STEP = WINDOW_CHARS - WINDOW_OVERLAP;

export class ComprehendRedactor implements PIIRedactor {
  readonly provider = "aws-comprehend";
  private client?: ComprehendClient;

  constructor(private readonly region: string) {}

  private async getClient(): Promise<ComprehendClient> {
    if (!this.client) {
      const { ComprehendClient: Client } = await import("@aws-sdk/client-comprehend");
      this.client = new Client({ region: this.region });
    }
    return this.client;
  }

  async redact(text: string): Promise<RedactedText> {
    const client = await this.getClient();
    const { DetectPiiEntitiesCommand } = await import("@aws-sdk/client-comprehend");
    const spans: PIISpan[] = [];

    // Process in overlapping windows; offsets are shifted by the window base so all
    // spans index the original text. Each entity is attributed to exactly one window
    // — the one whose non-overlapping "core" [0, WINDOW_STEP) contains its start — so
    // overlapping windows never produce duplicate spans.
    for (let base = 0; base < text.length; base += WINDOW_STEP) {
      const window = text.slice(base, base + WINDOW_CHARS);
      const isLastWindow = base + WINDOW_CHARS >= text.length;

      if (window.trim().length > 0) {
        const res = await client.send(
          new DetectPiiEntitiesCommand({ Text: window, LanguageCode: "en" }),
        );
        for (const entity of res.Entities ?? []) {
          const type = entity.Type ? COMPREHEND_TO_ENTITY[entity.Type] : undefined;
          if (!type || entity.BeginOffset === undefined || entity.EndOffset === undefined) continue;
          // Entities starting in the overlap tail are claimed by the next window's
          // core (where they're fully contained); skip them here to avoid duplicates.
          if (entity.BeginOffset < WINDOW_STEP || isLastWindow) {
            spans.push({ start: base + entity.BeginOffset, end: base + entity.EndOffset, type });
          }
        }
      }

      if (isLastWindow) break;
    }

    return applySpans(text, spans);
  }
}
