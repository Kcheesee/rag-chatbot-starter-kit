/** Public types for the ingestion package. */

import type { ChunkMetadata } from "@rag-chat-agent/vector-adapters";

/** A chunk produced by the chunker: text + metadata, not yet embedded. */
export interface Chunk {
  id: string;
  text: string;
  metadata: ChunkMetadata;
  contentHash: string;
}

/** Options controlling how documents are split into chunks. */
export interface ChunkOptions {
  /** Target chunk size, in tokens (approximated as ~4 chars/token). */
  chunkSize: number;
  /** Overlap between adjacent chunks, in tokens. */
  chunkOverlap: number;
  /** Namespace stamped on every produced chunk. */
  namespace: string;
}

/** PII entity categories the redactor detects and replaces. */
export type PIIEntity =
  | "PERSON"
  | "EMAIL_ADDRESS"
  | "PHONE_NUMBER"
  | "SSN"
  | "DATE_OF_BIRTH"
  | "STREET_ADDRESS"
  | "CREDIT_CARD";

/** Result of redacting a piece of text. */
export interface RedactedText {
  /** The text with detected entities replaced by `[REDACTED_<TYPE>]` placeholders. */
  text: string;
  /** Per-type counts of what was redacted (for the ingest summary / audit). */
  entitiesFound: Array<{ type: PIIEntity; count: number }>;
}

/** Contract for a PII redactor. Runs on chunk text before embedding. */
export interface PIIRedactor {
  redact(text: string): Promise<RedactedText>;
  readonly provider: string;
}

/** Config slice the PII redactor factory needs. */
export interface PIIConfig {
  PII_REDACTION_ENABLED: boolean;
  PII_REDACTION_PROVIDER: "presidio" | "aws-comprehend";
  PRESIDIO_URL?: string;
  /** Minimum Presidio confidence [0,1] for a span to be redacted. Defaults to 0 (redact all). */
  PRESIDIO_MIN_CONFIDENCE?: number;
  AWS_REGION?: string;
}

/** Options for a single ingest run. */
export interface IngestOptions {
  namespace: string;
  /** Token chunk size; defaults applied by the caller from env. */
  chunkSize?: number;
  /** Token overlap. */
  chunkOverlap?: number;
  /** Parse and chunk but do not embed or write to the vector store. */
  dryRun?: boolean;
}

/** Summary returned by `ingest()` and logged to the audit logger. */
export interface IngestResult {
  filesProcessed: number;
  chunksCreated: number;
  tokensProcessed: number;
  errors: number;
  namespace: string;
  /** Aggregated PII redaction counts across the run. */
  redacted: Array<{ type: PIIEntity; count: number }>;
}
