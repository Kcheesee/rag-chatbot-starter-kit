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
const WINDOW_CHARS = 4000;

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

    // Process in windows to respect the per-call size limit; offsets are adjusted
    // by the window base so all spans index the original text.
    for (let base = 0; base < text.length; base += WINDOW_CHARS) {
      const window = text.slice(base, base + WINDOW_CHARS);
      if (window.trim().length === 0) continue;

      const res = await client.send(
        new DetectPiiEntitiesCommand({ Text: window, LanguageCode: "en" }),
      );
      for (const entity of res.Entities ?? []) {
        const type = entity.Type ? COMPREHEND_TO_ENTITY[entity.Type] : undefined;
        if (type && entity.BeginOffset !== undefined && entity.EndOffset !== undefined) {
          spans.push({ start: base + entity.BeginOffset, end: base + entity.EndOffset, type });
        }
      }
    }

    return applySpans(text, spans);
  }
}
