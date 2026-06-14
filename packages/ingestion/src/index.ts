/**
 * @rag-chat-agent/ingestion — public surface.
 *
 * Turn sources into embedded, namespaced chunks: loaders → chunker → PII redactor
 * → embed → upsert. The `ingest()` pipeline and `createLoaders()` registry are the
 * primary consumer API (used by the ingest CLI and the admin ingest route).
 */

export type {
  Chunk,
  ChunkOptions,
  PIIEntity,
  RedactedText,
  PIIRedactor,
  PIIConfig,
  IngestOptions,
  IngestResult,
} from "./types";

export { chunkDocuments, estimateTokens } from "./chunker";

export { ingest, type IngestDeps } from "./ingest";

export {
  createLoaders,
  type LoaderSourceType,
  type LoaderCredentials,
} from "./loaders/registry";

// Loader hardening: SSRF + arbitrary-file-read guards and their shared policy type.
export {
  type LoaderSecurity,
  assertUrlAllowed,
  guardedFetch,
  assertPathAllowed,
} from "./loaders/security";

// Individual loaders, for direct use / extension.
export { PdfLoader } from "./loaders/pdf";
export { MarkdownLoader } from "./loaders/markdown";
export { DocxLoader } from "./loaders/docx";
export { TextLoader } from "./loaders/text";
export { UrlLoader, fetchPageText } from "./loaders/url";
export { SitemapLoader } from "./loaders/sitemap";
export { NotionLoader } from "./loaders/notion";
export { ConfluenceLoader } from "./loaders/confluence";

// PII redaction.
export { createPIIRedactor } from "./pii/factory";
export { PresidioRedactor } from "./pii/presidio";
export { ComprehendRedactor } from "./pii/comprehend";
