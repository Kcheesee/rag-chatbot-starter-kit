/**
 * Vector store selection and the config the adapters need.
 *
 * Like the other leaf packages, this one never reads process.env — keys match env
 * var names so the validated `Env` is structurally assignable to `VectorStoreConfig`
 * and `createVectorAdapter(env)` "just works".
 */

import { createHash } from "node:crypto";

/** Supported vector stores. */
export type VectorStore = "chroma" | "pinecone" | "pgvector" | "weaviate";

/** Postgres SSL posture. `require` is enforced under federal mode. */
export type PgSslMode = "require" | "prefer" | "disable";

/** Subset of env needed to build a vector adapter. */
export interface VectorStoreConfig {
  VECTOR_STORE: VectorStore;
  /** Base name for the store's collection/table/class. Default "rag_chunks". */
  VECTOR_NAMESPACE_PREFIX?: string;

  // Chroma
  CHROMA_URL?: string;

  // Pinecone
  PINECONE_API_KEY?: string;
  PINECONE_INDEX?: string;

  // Weaviate
  WEAVIATE_URL?: string;
  WEAVIATE_API_KEY?: string;

  // pgvector
  PGVECTOR_HOST?: string;
  PGVECTOR_PORT?: number;
  PGVECTOR_DATABASE?: string;
  PGVECTOR_USER?: string;
  PGVECTOR_PASSWORD?: string;
  PGVECTOR_SSL?: PgSslMode;
  PGVECTOR_TABLE?: string;
}

/** Default namespace when the caller doesn't scope the adapter. */
export const DEFAULT_NAMESPACE = "default";

/** Default base name for the store's primary container. */
export const DEFAULT_PREFIX = "rag_chunks";

/** Throw a clear, CONFIG.md-pointing error for a required-but-missing setting. */
export function requireConfig<T>(value: T | undefined, varName: string, hint: string): T {
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `${varName} is required for the selected vector store but was empty. ${hint} ` +
        `See CONFIG.md#vector-store.`,
    );
  }
  return value;
}

/**
 * Sanitise a namespace into a token safe for use in collection / table / class
 * names across stores (alphanumeric + underscore). Multi-tenant isolation relies on
 * this being stable and collision-free for distinct namespaces.
 *
 * The naive `replace(/[^a-zA-Z0-9_]/g, "_")` is NOT injective: "acme-corp" and
 * "acme_corp" both collapse to "acme_corp", which would silently merge two tenants'
 * collections. So when sanitisation is lossy we append a short, stable hash of the
 * ORIGINAL namespace, guaranteeing distinct inputs map to distinct, safe names. The
 * common case (already-safe names like "default" or "acme") is returned unchanged.
 */
export function sanitizeNamespace(ns: string): string {
  const cleaned = ns.replace(/[^a-zA-Z0-9_]/g, "_");
  if (cleaned.length === 0) return DEFAULT_NAMESPACE;
  if (cleaned === ns) return cleaned;
  const suffix = createHash("sha256").update(ns).digest("hex").slice(0, 8);
  return `${cleaned}_${suffix}`;
}
