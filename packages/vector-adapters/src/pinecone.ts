/**
 * Pinecone vector store adapter.
 *
 * Why this exists: Pinecone is the managed/serverless option in the adapter set.
 * Unlike Chroma or pgvector, it has first-class *namespaces* baked into the data
 * plane, so we lean on those for multi-tenant / RBAC isolation rather than
 * encoding the namespace into a collection or table name. Each adapter instance
 * is pinned to exactly one namespace and scopes every call through
 * `index.namespace(...)`.
 *
 * Two Pinecone-specific quirks shape this file:
 *
 *  1. Pinecone has no separate "document"/"text" field on a record — a record is
 *     `{ id, values, metadata }`. So we stash the chunk text *inside* metadata
 *     under a `text` key on write, and peel it back out on read. The shared
 *     `../metadata` helpers ignore unknown keys, so we can hand them the whole
 *     returned metadata record as the `record` arg and pass `text` separately.
 *
 *  2. The `@pinecone-database/pinecone` client is heavy and pulls in generated
 *     fetch code, so we `await import(...)` it lazily inside a memoised getter.
 *     An adapter that is constructed but never used (e.g. a namespace fan-out
 *     that ends up empty) never pays the import cost.
 *
 * NOTE on SDK version: the v7 data-plane methods take *object* options
 * (`upsert({ records })`, `fetch({ ids })`, `deleteMany({ ids })`), not the
 * bare-array signatures of older majors. This file targets v7.x.
 */

import type { VectorStoreConfig } from "./config";
import { DEFAULT_NAMESPACE, requireConfig, sanitizeNamespace } from "./config";
import { toFlatMetadata, toSearchResult, toStoredChunk } from "./metadata";
import type {
  EmbeddedChunk,
  MetadataFilter,
  SearchResult,
  StoredChunk,
  VectorAdapter,
} from "./types";

/**
 * Structural shape of the bits of the Pinecone SDK we actually touch.
 *
 * Why declare these locally instead of importing the SDK's types: the package
 * is an optional, lazily-imported peer. Importing its types eagerly at module
 * scope would couple our type-check to it being installed and defeat the lazy
 * `import()`. These mirror the v7 `Index` / `Pinecone` surface closely enough
 * to keep the call sites honest without any `any`.
 */
interface PineconeMetadata {
  [key: string]: string | number | boolean | string[] | undefined;
}

interface PineconeRecordLike {
  id: string;
  values?: number[];
  metadata?: PineconeMetadata;
}

interface PineconeScoredRecord extends PineconeRecordLike {
  score?: number;
}

interface PineconeIndexLike {
  namespace(ns: string): PineconeIndexLike;
  upsert(options: { records: PineconeRecordLike[] }): Promise<void>;
  query(options: {
    vector: number[];
    topK: number;
    includeMetadata?: boolean;
    includeValues?: boolean;
    filter?: object;
  }): Promise<{ matches?: PineconeScoredRecord[] }>;
  fetch(options: { ids: string[] }): Promise<{
    records?: Record<string, PineconeRecordLike>;
  }>;
  deleteMany(options: { ids: string[] }): Promise<void>;
}

interface PineconeClientLike {
  index(name: string): PineconeIndexLike;
}

interface PineconeModule {
  Pinecone: new (options: { apiKey: string }) => PineconeClientLike;
}

/** Clamp a similarity score into the documented [0, 1] range. */
function clampScore(score: number | undefined): number {
  if (score === undefined || Number.isNaN(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/**
 * Pull the chunk text out of a returned Pinecone metadata record.
 *
 * Text is stored *in* metadata (Pinecone has no document field), so on read we
 * recover it from `record.text`. The rest of the record is handed to the shared
 * `../metadata` helpers, which ignore the extra `text` key.
 */
function extractText(metadata: PineconeMetadata | undefined): string {
  return String(metadata?.text ?? "");
}

/**
 * `VectorAdapter` backed by Pinecone, scoped to a single native namespace.
 *
 * Construct one per namespace; call {@link PineconeAdapter.namespace} to get a
 * sibling scoped to a different namespace sharing the same config. The client
 * and index handle are memoised per instance so repeated calls reuse one
 * connection.
 */
export class PineconeAdapter implements VectorAdapter {
  /** Memoised, namespace-scoped index handle (resolves the lazy SDK import once). */
  private indexPromise?: Promise<PineconeIndexLike>;

  /**
   * @param cfg - Validated vector-store config; must carry `PINECONE_API_KEY`
   *   and `PINECONE_INDEX`. Validated eagerly so misconfiguration fails at
   *   construction, not on the first query.
   * @param ns - Namespace this adapter is pinned to. Defaults to the shared
   *   default namespace.
   */
  constructor(
    private readonly cfg: VectorStoreConfig,
    private readonly ns: string = DEFAULT_NAMESPACE,
  ) {
    requireConfig(
      cfg.PINECONE_API_KEY,
      "PINECONE_API_KEY",
      "Set it to your Pinecone project API key.",
    );
    requireConfig(
      cfg.PINECONE_INDEX,
      "PINECONE_INDEX",
      "Set it to the name of your Pinecone index.",
    );
  }

  /**
   * Lazily import the Pinecone client, build the index handle, and scope it to
   * this adapter's namespace — memoised so the dynamic import and handle
   * construction happen at most once per instance.
   *
   * We use a *native* Pinecone namespace (`index.namespace(...)`) rather than a
   * metadata filter: it is the idiomatic, server-side isolation primitive and
   * keeps tenant data physically partitioned.
   */
  private getIndex(): Promise<PineconeIndexLike> {
    if (this.indexPromise === undefined) {
      this.indexPromise = (async (): Promise<PineconeIndexLike> => {
        let mod: PineconeModule;
        try {
          mod = (await import("@pinecone-database/pinecone")) as PineconeModule;
        } catch {
          throw new Error(
            "The '@pinecone-database/pinecone' package is required for the Pinecone " +
              "vector store but could not be loaded. Install it with " +
              "`npm i @pinecone-database/pinecone`. See CONFIG.md#vector-store.",
          );
        }
        const apiKey = requireConfig(
          this.cfg.PINECONE_API_KEY,
          "PINECONE_API_KEY",
          "Set it to your Pinecone project API key.",
        );
        const indexName = requireConfig(
          this.cfg.PINECONE_INDEX,
          "PINECONE_INDEX",
          "Set it to the name of your Pinecone index.",
        );
        const client = new mod.Pinecone({ apiKey });
        return client.index(indexName).namespace(sanitizeNamespace(this.ns));
      })();
    }
    return this.indexPromise;
  }

  /**
   * Top-K nearest-neighbour search within this namespace.
   *
   * The index is assumed to use the cosine metric, so `match.score` is already a
   * cosine similarity in roughly [0, 1]; we clamp defensively. Chunk text is
   * recovered from `metadata.text`; the full metadata record (minus the text we
   * pulled) is reconstructed by the shared helper.
   */
  async search(
    embedding: number[],
    topK: number,
    filter?: MetadataFilter,
  ): Promise<SearchResult[]> {
    const index = await this.getIndex();
    const response = await index.query({
      vector: embedding,
      topK,
      includeMetadata: true,
      // Pinecone's filter syntax accepts our flat equality/membership filter
      // as-is; `undefined` keys are dropped by the wire serialiser.
      ...(filter !== undefined ? { filter: filter as object } : {}),
    });
    const matches = response.matches ?? [];
    return matches.map((match) =>
      toSearchResult(
        match.id,
        extractText(match.metadata),
        match.metadata ?? {},
        clampScore(match.score),
      ),
    );
  }

  /**
   * Insert or update chunks (idempotent on `id`).
   *
   * The chunk text is folded into metadata under `text` because Pinecone records
   * have no dedicated text field; on read we reverse this in {@link extractText}.
   */
  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const index = await this.getIndex();
    const records: PineconeRecordLike[] = chunks.map((c) => ({
      id: c.id,
      values: c.embedding,
      metadata: { ...toFlatMetadata(c.metadata), text: c.text },
    }));
    await index.upsert({ records });
  }

  /** Delete chunks by id within this namespace. No-op on an empty list. */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const index = await this.getIndex();
    await index.deleteMany({ ids });
  }

  /**
   * Fetch a single chunk by id, or `null` if absent.
   *
   * This is the load-bearing method for the response cache's grounding check,
   * which re-reads a chunk by id to compare its current `contentHash` against
   * the hash captured when an answer was cached.
   */
  async getById(id: string): Promise<StoredChunk | null> {
    const index = await this.getIndex();
    const response = await index.fetch({ ids: [id] });
    const record = response.records?.[id];
    if (record === undefined) return null;
    return toStoredChunk(id, extractText(record.metadata), record.metadata ?? {});
  }

  /**
   * Return a sibling adapter scoped to a different namespace, sharing this
   * adapter's config. Used for multi-tenant isolation and federal-mode RBAC
   * partitioning of the knowledge base.
   */
  namespace(ns: string): VectorAdapter {
    return new PineconeAdapter(this.cfg, ns);
  }
}
