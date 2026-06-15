/** Build the configured PII redactor, or null when redaction is disabled. */

import type { PIIConfig, PIIRedactor } from "../types";
import { PresidioRedactor } from "./presidio";
import { ComprehendRedactor } from "./comprehend";

/**
 * Returns a redactor when `PII_REDACTION_ENABLED` is true, else null — so the
 * ingest pipeline can treat "no redaction" as simply "no redactor" without a flag
 * check at every call site.
 */
export function createPIIRedactor(config: PIIConfig): PIIRedactor | null {
  if (!config.PII_REDACTION_ENABLED) return null;

  switch (config.PII_REDACTION_PROVIDER) {
    case "presidio":
      return new PresidioRedactor(
        config.PRESIDIO_URL ?? "http://localhost:5002",
        config.PRESIDIO_MIN_CONFIDENCE ?? 0,
      );
    case "aws-comprehend":
      return new ComprehendRedactor(config.AWS_REGION ?? "us-east-1");
    default: {
      const exhaustive: never = config.PII_REDACTION_PROVIDER;
      throw new Error(
        `Unknown PII_REDACTION_PROVIDER: "${String(exhaustive)}". ` +
          `Valid values: presidio | aws-comprehend. See CONFIG.md#pii-redaction.`,
      );
    }
  }
}
