/**
 * Chroma vector store adapter.
 *
 * Why one collection per namespace (rather than a single collection partitioned by a
 * metadata field): Chroma's strongest isolation boundary is the collection. Routing
 * each namespace to its own collection gives us clean multi-tenant / RBAC separation —
 * a query physically cannot leak across tenants — and lets each namespace's HNSW index
 * grow independently. `namespace(ns)` therefore returns a sibling adapter bound to a
 * different collection, never a filtered view of a shared one.
 *
 * Why cosine distance is configured at collection-creation time: we store the
 * `"hnsw:space": "cosine"` setting on the collection so the server returns cosine
 * *distance*, which we convert to a cosine *similarity* score (`1 - distance`) to match
 * the `SearchResult` contract (higher = closer, in [0, 1]).
 *
 * Why the chromadb SDK is loaded lazily: this package ships four adapters but a given
 * deployment uses exactly one. A dynamic `import("chromadb")` behind a memoised getter
 * keeps the (non-trivial) SDK out of the module graph unless this store is actually
 * selected, so picking pgvector never pays for Chroma's dependency tree.
 */

import {
  DEFAULT_NAMESPACE,
  DEFAULT_PREFIX,
  sanitizeNamespace,
  type VectorStoreConfig,
} from "./config";
import { toFlatMetadata, toSearchResult, toStoredChunk } from "./metadata";
import type {
  EmbeddedChunk,
  MetadataFilter,
  SearchResult,
  StoredChunk,
  VectorAdapter,
} from "./types";

/** Default Chroma server endpoint when `CHROMA_URL` is not configured. */
const DEFAULT_CHROMA_URL = "http://localhost:8000";

/**
 * Structural subset of the `chromadb` SDK we depend on.
 *
 * We type the dynamic import structurally instead of importing the SDK's own types so
 * that nothing in the static module graph references `chromadb`, preserving the
 * lazy-load guarantee. Only the methods this adapter calls are declared.
 */
interface ChromaCollection {
  upsert(args: {
    ids: string[];
    embeddings: number[][];
    documents: string[];
    metadatas: Record<string, string | number | boolean>[];
  }): Promise<void>;
  query(args: {
    queryEmbeddings: number[][];
    nResults: number;
    where?: Record<string, unknown>;
  }): Promise<{
    ids: string[][];
    documents: (string | null)[][];
    metadatas: (Record<string, unknown> | null)[][];
    distances: (number | null)[][];
  }>;
  get(args: { ids: string[] }): Promise<{
    ids: string[];
    documents: (string | null)[];
    metadatas: (Record<string, unknown> | null)[];
  }>;
  delete(args: { ids: string[] }): Promise<void>;
}

interface ChromaClientLike {
  getOrCreateCollection(args: {
    name: string;
    metadata?: Record<string, string | number | boolean>;
    embeddingFunction?: unknown;
  }): Promise<ChromaCollection>;
}

interface ChromaModule {
  ChromaClient: new (args: { path: string }) => ChromaClientLike;
}

/**
 * Minimal embedding-function stub.
 *
 * We always supply embeddings explicitly on both `upsert` and `query`, so the
 * collection's embedding function is never invoked. Passing this stub (rather than
 * omitting the argument) prevents the SDK from instantiating a model-backed default
 * embedding function, which would otherwise pull a heavyweight dependency at runtime.
 * If `generate` is ever called it indicates a programming error — hence the throw.
 */
class ExplicitEmbeddingsStub {
  public readonly name = "explicit-embeddings-stub";

  public async generate(_texts: string[]): Promise<number[][]> {
    throw new Error(
      "embeddings are supplied explicitly; the Chroma embedding function must not be called. " +
        "See CONFIG.md#vector-store.",
    );
  }
}

/**
 * Chroma-backed implementation of {@link VectorAdapter}.
 *
 * Instances are cheap and namespace-scoped: the SDK module, the client, and the
 * collection are each resolved lazily and memoised per instance, so constructing an
 * adapter does no I/O until the first store operation.
 */
export class ChromaAdapter implements VectorAdapter {
  /** Memoised dynamic import of the SDK, shared by all instances via the module cache. */
  private modulePromise: Promise<ChromaModule> | undefined;
  /** Memoised client (one connection per instance). */
  private clientPromise: Promise<ChromaClientLike> | undefined;
  /** Memoised collection handle for this instance's namespace. */
  private collectionPromise: Promise<ChromaCollection> | undefined;

  public constructor(
    private readonly cfg: VectorStoreConfig,
    private readonly ns: string = DEFAULT_NAMESPACE,
  ) {}

  /** Return a sibling adapter bound to a different namespace (its own collection). */
  public namespace(ns: string): VectorAdapter {
    return new ChromaAdapter(this.cfg, ns);
  }

  /**
   * Collection name for this namespace: `${prefix}__${sanitizeNamespace(ns)}`.
   *
   * The prefix groups all of this deployment's collections under a common name, and the
   * sanitised namespace makes the boundary collision-free and Chroma-name-safe.
   */
  private collectionName(): string {
    const prefix = this.cfg.VECTOR_NAMESPACE_PREFIX ?? DEFAULT_PREFIX;
    return `${prefix}__${sanitizeNamespace(this.ns)}`;
  }

  /**
   * Lazily import the `chromadb` SDK.
   *
   * Kept behind a getter so the dynamic `import` only runs when this store is exercised,
   * honouring the "don't load the SDK unless used" contract. A clear, CONFIG-pointing
   * error is thrown if the optional dependency isn't installed.
   */
  private async loadModule(): Promise<ChromaModule> {
    if (this.modulePromise === undefined) {
      this.modulePromise = (async (): Promise<ChromaModule> => {
        try {
          return (await import("chromadb")) as unknown as ChromaModule;
        } catch (cause) {
          throw new Error(
            "Failed to load the 'chromadb' package. Install it to use the Chroma vector store. " +
              "See CONFIG.md#vector-store.",
            { cause },
          );
        }
      })();
    }
    return this.modulePromise;
  }

  /** Memoised Chroma client pointed at `CHROMA_URL` (defaulting to localhost). */
  private async client(): Promise<ChromaClientLike> {
    if (this.clientPromise === undefined) {
      this.clientPromise = (async (): Promise<ChromaClientLike> => {
        const { ChromaClient } = await this.loadModule();
        const path = this.cfg.CHROMA_URL ?? DEFAULT_CHROMA_URL;
        return new ChromaClient({ path });
      })();
    }
    return this.clientPromise;
  }

  /**
   * Memoised collection handle for this instance's namespace.
   *
   * Created with `{ "hnsw:space": "cosine" }` so the server computes cosine distance;
   * we pass the explicit-embeddings stub so no model-backed default is instantiated.
   */
  private async collection(): Promise<ChromaCollection> {
    if (this.collectionPromise === undefined) {
      this.collectionPromise = (async (): Promise<ChromaCollection> => {
        const client = await this.client();
        try {
          return await client.getOrCreateCollection({
            name: this.collectionName(),
            metadata: { "hnsw:space": "cosine" },
            embeddingFunction: new ExplicitEmbeddingsStub(),
          });
        } catch (cause) {
          throw new Error(
            `Failed to open Chroma collection "${this.collectionName()}". ` +
              "Verify CHROMA_URL points at a reachable Chroma server. See CONFIG.md#vector-store.",
            { cause },
          );
        }
      })();
    }
    return this.collectionPromise;
  }

  /**
   * Top-K nearest-neighbour search, optionally filtered by metadata.
   *
   * Chroma groups results per query embedding, so a single-query request returns
   * arrays-of-arrays; we read row `[0]`. Distance is converted to a similarity score via
   * `1 - distance`, and rows missing a document or metadata are skipped rather than
   * surfaced as malformed results.
   */
  public async search(
    embedding: number[],
    topK: number,
    filter?: MetadataFilter,
  ): Promise<SearchResult[]> {
    const collection = await this.collection();
    const response = await collection.query({
      queryEmbeddings: [embedding],
      nResults: topK,
      where: filter as Record<string, unknown> | undefined,
    });

    const ids = response.ids[0] ?? [];
    const documents = response.documents[0] ?? [];
    const metadatas = response.metadatas[0] ?? [];
    const distances = response.distances[0] ?? [];

    const results: SearchResult[] = [];
    for (let i = 0; i < ids.length; i += 1) {
      const document = documents[i];
      const metadata = metadatas[i];
      const distance = distances[i];
      if (document == null || metadata == null || distance == null) continue;
      results.push(toSearchResult(ids[i], document, metadata, 1 - distance));
    }
    return results;
  }

  /**
   * Insert or update chunks, idempotent on `id`.
   *
   * Embeddings are supplied directly; metadata is flattened to scalars via the shared
   * helper so every adapter round-trips `ChunkMetadata` identically.
   */
  public async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const collection = await this.collection();
    await collection.upsert({
      ids: chunks.map((c) => c.id),
      embeddings: chunks.map((c) => c.embedding),
      documents: chunks.map((c) => c.text),
      metadatas: chunks.map((c) => toFlatMetadata(c.metadata)),
    });
  }

  /** Delete chunks by id. */
  public async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const collection = await this.collection();
    await collection.delete({ ids });
  }

  /**
   * Fetch a single chunk by id, or `null` if absent.
   *
   * Required by the response cache's grounding check, which re-reads the chunk to
   * compare its current `contentHash` against the hash captured when an answer was
   * cached. `get` returns flat (non-nested) arrays; a missing or document-less row maps
   * to `null`.
   */
  public async getById(id: string): Promise<StoredChunk | null> {
    const collection = await this.collection();
    const response = await collection.get({ ids: [id] });
    if (response.ids.length === 0) return null;

    const document = response.documents[0];
    const metadata = response.metadatas[0];
    if (document == null || metadata == null) return null;

    return toStoredChunk(response.ids[0], document, metadata);
  }
}
