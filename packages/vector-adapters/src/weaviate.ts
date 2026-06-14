/**
 * Weaviate adapter (modern `weaviate-client` v3, gRPC-backed).
 *
 * Design notes that explain the non-obvious choices in this file:
 *
 * - One collection, namespace as a PROPERTY. Weaviate offers native
 *   multi-tenancy, but the other adapters (Chroma/Pinecone/pgvector) isolate
 *   tenants with a plain `namespace` field filtered on every read. We mirror
 *   that here for uniform behaviour and so a single collection config (vectorizer
 *   `none`, cosine distance) serves every namespace. Every read AND-combines a
 *   `namespace == this.ns` filter.
 *
 * - Deterministic UUIDs. Weaviate object IDs must be valid UUIDs, but the ids we
 *   bring (chunk ids) are arbitrary strings. We derive a stable UUIDv5 from the
 *   chunk id (`generateUuid5`) so the same chunk id always maps to the same
 *   Weaviate object — making `upsert` idempotent and letting `getById`/`delete`
 *   address objects without a lookup table. The original id is also stored as the
 *   `chunkId` property so reads can return it verbatim.
 *
 * - Lazy everything. The client is a heavy gRPC dependency, so it is imported and
 *   connected only on first use (see `getCollection`) and memoised thereafter.
 */

import type { VectorStoreConfig } from "./config";
import { DEFAULT_NAMESPACE, DEFAULT_PREFIX, requireConfig, sanitizeNamespace } from "./config";
import { toFlatMetadata, toSearchResult, toStoredChunk } from "./metadata";
import type {
  EmbeddedChunk,
  MetadataFilter,
  SearchResult,
  StoredChunk,
  VectorAdapter,
} from "./types";

/**
 * Structural type for the slice of `weaviate-client` we use. We import the module
 * dynamically (so the dependency stays optional/lazy) and type the handle
 * structurally to avoid a hard build-time dependency on the package's types while
 * still keeping `any` out of the file.
 */
interface WeaviateModule {
  readonly default: WeaviateConnect;
  readonly ApiKey: new (key: string) => unknown;
  readonly Filters: {
    and(...filters: WeaviateFilterValue[]): WeaviateFilterValue;
  };
  readonly vectors: {
    selfProvided(opts?: { vectorIndexConfig?: unknown }): unknown;
  };
  readonly configure: {
    vectorIndex: { hnsw(opts?: { distanceMetric?: string }): unknown };
  };
  readonly dataType: { readonly TEXT: string; readonly INT: string };
  readonly vectorDistances: { readonly COSINE: string };
  generateUuid5(namespace: string, identifier?: string): string;
}

interface WeaviateConnect {
  connectToCustom(opts: {
    httpHost: string;
    httpPort: number;
    httpSecure: boolean;
    grpcHost: string;
    grpcPort: number;
    grpcSecure: boolean;
    authCredentials?: unknown;
  }): Promise<WeaviateClient>;
  connectToWeaviateCloud(
    clusterUrl: string,
    opts: { authCredentials?: unknown },
  ): Promise<WeaviateClient>;
}

interface WeaviateClient {
  collections: {
    exists(name: string): Promise<boolean>;
    create(config: unknown): Promise<WeaviateCollection>;
    get(name: string): WeaviateCollection;
  };
}

/** A filter value produced by `collection.filter.byProperty(...).<op>(...)`. */
type WeaviateFilterValue = unknown;

interface WeaviateCollection {
  readonly filter: {
    byProperty(name: string): {
      equal(value: string | number | boolean): WeaviateFilterValue;
      containsAny(value: Array<string | number>): WeaviateFilterValue;
    };
  };
  readonly data: {
    insertMany(objects: WeaviateInsert[]): Promise<unknown>;
    deleteById(id: string): Promise<unknown>;
  };
  readonly query: {
    nearVector(
      vector: number[],
      opts: { limit: number; returnMetadata: string[]; filters?: WeaviateFilterValue },
    ): Promise<{ objects: WeaviateObject[] }>;
    fetchObjectById(id: string): Promise<WeaviateObject | null>;
  };
}

interface WeaviateInsert {
  id: string;
  properties: Record<string, string | number | boolean>;
  vectors: number[];
}

interface WeaviateObject {
  uuid: string;
  properties: Record<string, unknown>;
  metadata?: { distance?: number };
}

/**
 * Vector store backed by Weaviate. Construct once per process; call `namespace`
 * to obtain cheap, isolated views that share the underlying collection.
 */
export class WeaviateAdapter implements VectorAdapter {
  /**
   * Memoised connected collection handle. Shared across all namespace views of a
   * given config would be ideal, but views are independent instances; the cost is
   * one connection per distinct namespace adapter, which is acceptable and keeps
   * the lifecycle simple. The promise is cached so concurrent first-calls share a
   * single connect + ensure-exists round trip.
   */
  private collectionPromise?: Promise<WeaviateCollection>;

  /**
   * @param cfg Vector store config. `WEAVIATE_URL` is validated eagerly so a
   *   misconfiguration fails fast at construction rather than on first query.
   * @param ns Namespace this view is scoped to.
   */
  constructor(
    private readonly cfg: VectorStoreConfig,
    private readonly ns: string = DEFAULT_NAMESPACE,
  ) {
    requireConfig(cfg.WEAVIATE_URL, "WEAVIATE_URL", "Set it to your Weaviate endpoint, e.g. http://localhost:8080.");
  }

  /**
   * Weaviate class names must start with an uppercase letter. We derive the class
   * name from the configured prefix once and reuse it everywhere. Namespace is NOT
   * part of the class name — it is a filtered property (see file header).
   */
  private get className(): string {
    const prefix = sanitizeNamespace(this.cfg.VECTOR_NAMESPACE_PREFIX ?? DEFAULT_PREFIX);
    return prefix.charAt(0).toUpperCase() + prefix.slice(1);
  }

  /**
   * Lazily import the client, connect, ensure the collection exists, and memoise
   * the resulting handle. Kept private and idempotent so every public method can
   * `await this.getCollection()` without worrying about ordering or double-connect.
   */
  private getCollection(): Promise<WeaviateCollection> {
    if (this.collectionPromise === undefined) {
      this.collectionPromise = this.connectAndEnsure().catch((err: unknown) => {
        // Reset on failure so a later call can retry instead of caching the rejection.
        this.collectionPromise = undefined;
        throw err;
      });
    }
    return this.collectionPromise;
  }

  private async connectAndEnsure(): Promise<WeaviateCollection> {
    const weaviate = (await import("weaviate-client")) as unknown as WeaviateModule;
    const client = await this.connect(weaviate);
    const name = this.className;

    // Create-if-missing. Concurrent processes can race here; a parallel create that
    // loses the race throws "already exists", which we treat as success.
    if (!(await client.collections.exists(name))) {
      try {
        await client.collections.create({
          name,
          vectorizers: weaviate.vectors.selfProvided({
            vectorIndexConfig: weaviate.configure.vectorIndex.hnsw({
              distanceMetric: weaviate.vectorDistances.COSINE,
            }),
          }),
          properties: [
            { name: "content", dataType: weaviate.dataType.TEXT },
            { name: "chunkId", dataType: weaviate.dataType.TEXT },
            { name: "sourceFile", dataType: weaviate.dataType.TEXT },
            { name: "sourceType", dataType: weaviate.dataType.TEXT },
            { name: "chunkIndex", dataType: weaviate.dataType.INT },
            { name: "pageNumber", dataType: weaviate.dataType.INT },
            { name: "heading", dataType: weaviate.dataType.TEXT },
            { name: "contentHash", dataType: weaviate.dataType.TEXT },
            { name: "ingestedAt", dataType: weaviate.dataType.TEXT },
            { name: "namespace", dataType: weaviate.dataType.TEXT },
          ],
        });
      } catch (err: unknown) {
        if (!(await client.collections.exists(name))) {
          throw new Error(
            `Failed to create Weaviate collection "${name}": ${stringifyError(err)} ` +
              `See CONFIG.md#vector-store.`,
          );
        }
      }
    }

    return client.collections.get(name);
  }

  /**
   * Parse `WEAVIATE_URL` into a connection. A Weaviate Cloud host (`*.weaviate.network`
   * / `*.weaviate.cloud`) uses the dedicated cloud connector; anything else is
   * treated as a self-hosted endpoint and connected via `connectToCustom`, deriving
   * the gRPC port from the scheme (8080→50051 plaintext, 443→443 secure) the way the
   * standard self-hosted setup exposes it.
   */
  private async connect(weaviate: WeaviateModule): Promise<WeaviateClient> {
    const rawUrl = this.cfg.WEAVIATE_URL as string;
    const apiKey = this.cfg.WEAVIATE_API_KEY;
    const authCredentials = apiKey !== undefined && apiKey !== "" ? new weaviate.ApiKey(apiKey) : undefined;

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error(
        `WEAVIATE_URL "${rawUrl}" is not a valid URL. ` +
          `Use a full URL such as http://localhost:8080 or https://my-cluster.weaviate.network. ` +
          `See CONFIG.md#vector-store.`,
      );
    }

    const isSecure = url.protocol === "https:";
    const host = url.hostname;

    if (host.endsWith("weaviate.network") || host.endsWith("weaviate.cloud")) {
      return weaviate.default.connectToWeaviateCloud(rawUrl, { authCredentials });
    }

    const httpPort = url.port !== "" ? Number(url.port) : isSecure ? 443 : 8080;
    return weaviate.default.connectToCustom({
      httpHost: host,
      httpPort,
      httpSecure: isSecure,
      grpcHost: host,
      // Self-hosted Weaviate exposes gRPC on 50051 (plaintext) and 443 (secure/proxied).
      grpcPort: isSecure ? 443 : 50051,
      grpcSecure: isSecure,
      authCredentials,
    });
  }

  /** Derive the stable Weaviate object UUID for a given chunk id. */
  private async derivedUuid(id: string): Promise<string> {
    const weaviate = (await import("weaviate-client")) as unknown as WeaviateModule;
    // Namespacing the v5 derivation by class name keeps ids distinct across stores.
    return weaviate.generateUuid5(this.className, id);
  }

  /**
   * Build the where-filter applied to every read: always `namespace == this.ns`,
   * AND-combined with any caller-supplied metadata equality/membership filters.
   */
  private async buildFilter(
    collection: WeaviateCollection,
    filter?: MetadataFilter,
  ): Promise<WeaviateFilterValue> {
    const weaviate = (await import("weaviate-client")) as unknown as WeaviateModule;
    const clauses: WeaviateFilterValue[] = [collection.filter.byProperty("namespace").equal(this.ns)];

    if (filter !== undefined) {
      for (const [key, value] of Object.entries(filter)) {
        if (value === undefined) continue;
        clauses.push(
          Array.isArray(value)
            ? collection.filter.byProperty(key).containsAny(value)
            : collection.filter.byProperty(key).equal(value),
        );
      }
    }

    return clauses.length === 1 ? clauses[0] : weaviate.Filters.and(...clauses);
  }

  async search(embedding: number[], topK: number, filter?: MetadataFilter): Promise<SearchResult[]> {
    const collection = await this.getCollection();
    const filters = await this.buildFilter(collection, filter);

    const response = await collection.query.nearVector(embedding, {
      limit: topK,
      returnMetadata: ["distance"],
      filters,
    });

    return response.objects.map((obj) => {
      // Cosine distance is in [0, 2]; cosine similarity = 1 - distance lands in [0, 1]
      // for normalised embeddings, matching the SearchResult.score contract.
      const distance = obj.metadata?.distance ?? 1;
      // Cosine distance is [0, 2], so 1 - distance can be negative for near-opposite
      // vectors; clamp to the [0, 1] similarity our contract (and the confidence
      // gate) promises.
      const score = Math.max(0, Math.min(1, 1 - distance));
      const props = obj.properties;
      return toSearchResult(String(props["chunkId"] ?? ""), String(props["content"] ?? ""), props, score);
    });
  }

  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const collection = await this.getCollection();

    const objects: WeaviateInsert[] = await Promise.all(
      chunks.map(async (c) => ({
        id: await this.derivedUuid(c.id),
        properties: {
          content: c.text,
          chunkId: c.id,
          ...toFlatMetadata(c.metadata),
        },
        vectors: c.embedding,
      })),
    );

    // Weaviate's insertMany does NOT replace an object that already exists at the
    // same UUID — it errors/skips it. For idempotent upsert (re-ingesting a changed
    // chunk must refresh its content + contentHash, or the cache grounding check
    // would never see the change), delete any existing objects by their derived
    // UUID first, then insert. deleteById on a missing id is a no-op we ignore.
    await Promise.all(objects.map((o) => collection.data.deleteById(o.id).catch(() => undefined)));
    await collection.data.insertMany(objects);
  }

  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const collection = await this.getCollection();
    await Promise.all(
      ids.map(async (id) => collection.data.deleteById(await this.derivedUuid(id))),
    );
  }

  async getById(id: string): Promise<StoredChunk | null> {
    const collection = await this.getCollection();
    const obj = await collection.query.fetchObjectById(await this.derivedUuid(id));
    if (obj === null) return null;

    // Enforce namespace isolation on the read path: an object with a colliding
    // derived UUID from another namespace must not leak across the boundary.
    if (obj.properties["namespace"] !== this.ns) return null;

    return toStoredChunk(id, String(obj.properties["content"] ?? ""), obj.properties);
  }

  /** Return a view scoped to `ns`, sharing this adapter's config. */
  namespace(ns: string): VectorAdapter {
    return new WeaviateAdapter(this.cfg, ns);
  }
}

/** Best-effort error message extraction for thrown non-Error values. */
function stringifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : JSON.stringify(err);
}
