/**
 * `deleteBySource` behaviour across the four adapters.
 *
 * Each adapter lazily `await import(...)`s its SDK, so we intercept that import with
 * `vi.mock` and assert the adapter issues the *right native call* for clearing a
 * source's stale chunks — without any real network/database I/O. These mocks declare
 * only the surface each adapter touches; the structural client types in the adapters
 * keep that honest.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VectorStoreConfig } from "../config";

const SOURCE = "/docs/returns.md";
const NS = "acme";

beforeEach(() => {
  // Start each test from a clean module registry so doMock/resetModules pairs
  // don't bleed a previous adapter build (or a cached pool) into the next.
  vi.resetModules();
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// pgvector — DELETE scoped to namespace + metadata->>'sourceFile', params [ns, src]
// ---------------------------------------------------------------------------
describe("PgVectorAdapter.deleteBySource", () => {
  it("issues the namespaced DELETE keyed on metadata->>'sourceFile' with [ns, sourceFile]", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const connect = vi.fn().mockResolvedValue({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn(),
    });
    // ensureSchema connects once; deleteBySource then calls pool.query directly.
    const fakePool = { query, connect, end: vi.fn() };

    vi.doMock("pg", () => ({ Pool: vi.fn(() => fakePool) }));
    // Fresh import so the module-level POOL_CACHE / SCHEMA_READY don't leak the mock
    // (or a prior pool) across tests.
    vi.resetModules();
    const { PgVectorAdapter: FreshAdapter } = await import("../pgvector");

    const cfg: VectorStoreConfig = { VECTOR_STORE: "pgvector", PGVECTOR_HOST: "localhost" };
    const adapter = new FreshAdapter(cfg, NS);
    await adapter.deleteBySource(SOURCE);

    // The data-plane delete goes through pool.query (not a transaction client).
    const deleteCall = query.mock.calls.find(([sql]) =>
      typeof sql === "string" && sql.includes("DELETE FROM"),
    );
    expect(deleteCall).toBeDefined();
    const [sql, params] = deleteCall as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM \w+ WHERE namespace = \$1 AND metadata->>'sourceFile' = \$2;/);
    expect(params).toEqual([NS, SOURCE]);

    vi.doUnmock("pg");
  });
});

// ---------------------------------------------------------------------------
// chroma — collection.delete called with a `where: { sourceFile }`
// ---------------------------------------------------------------------------
describe("ChromaAdapter.deleteBySource", () => {
  it("deletes via a { where: { sourceFile } } metadata filter on the namespace collection", async () => {
    const del = vi.fn().mockResolvedValue(undefined);
    const collection = { delete: del };
    const getOrCreateCollection = vi.fn().mockResolvedValue(collection);
    const ChromaClient = vi.fn(() => ({ getOrCreateCollection }));

    vi.doMock("chromadb", () => ({ ChromaClient }));
    vi.resetModules();
    const { ChromaAdapter: FreshAdapter } = await import("../chroma");

    const cfg: VectorStoreConfig = { VECTOR_STORE: "chroma", CHROMA_URL: "http://localhost:8000" };
    const adapter = new FreshAdapter(cfg, NS);
    await adapter.deleteBySource(SOURCE);

    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith({ where: { sourceFile: SOURCE } });

    vi.doUnmock("chromadb");
  });
});

// ---------------------------------------------------------------------------
// weaviate — filtered data.deleteMany over namespace == ns AND sourceFile == src
// ---------------------------------------------------------------------------
describe("WeaviateAdapter.deleteBySource", () => {
  it("builds a namespace+sourceFile filter and issues a single native deleteMany", async () => {
    // Sentinels let us assert which clauses were combined without depending on the
    // real Weaviate filter object shape.
    const nsClause = { _clause: "namespace==acme" };
    const srcClause = { _clause: "sourceFile==src" };
    const andFilter = { _and: [nsClause, srcClause] };

    // `equal` returns our sentinel clauses so we can assert exactly which property
    // clauses were AND-combined, independent of the real Weaviate filter shape.
    const byProperty = vi.fn((name: string) => ({
      equal: (value: unknown) => {
        if (name === "namespace") return nsClause;
        if (name === "sourceFile" && value === SOURCE) return srcClause;
        return { _clause: `${name}==${String(value)}` };
      },
      containsAny: () => ({ _clause: `${name}#contains` }),
    }));

    const deleteMany = vi.fn().mockResolvedValue(undefined);
    const collection = {
      filter: { byProperty },
      data: { deleteMany, insertMany: vi.fn(), deleteById: vi.fn() },
      query: { nearVector: vi.fn(), fetchObjectById: vi.fn() },
    };

    const Filters = { and: vi.fn((...fs: unknown[]) => ({ _and: fs })) };
    const client = {
      collections: {
        exists: vi.fn().mockResolvedValue(true),
        create: vi.fn(),
        get: vi.fn(() => collection),
      },
    };
    const weaviateModule = {
      default: {
        connectToCustom: vi.fn().mockResolvedValue(client),
        connectToWeaviateCloud: vi.fn().mockResolvedValue(client),
      },
      ApiKey: vi.fn(),
      Filters,
      vectors: { selfProvided: vi.fn() },
      configure: { vectorIndex: { hnsw: vi.fn() } },
      dataType: { TEXT: "text", INT: "int" },
      vectorDistances: { COSINE: "cosine" },
      generateUuid5: vi.fn(() => "00000000-0000-0000-0000-000000000000"),
    };

    vi.doMock("weaviate-client", () => weaviateModule);
    vi.resetModules();
    const { WeaviateAdapter: FreshAdapter } = await import("../weaviate");

    const cfg: VectorStoreConfig = { VECTOR_STORE: "weaviate", WEAVIATE_URL: "http://localhost:8080" };
    const adapter = new FreshAdapter(cfg, NS);
    await adapter.deleteBySource(SOURCE);

    // namespace clause and sourceFile clause were AND-combined...
    expect(byProperty).toHaveBeenCalledWith("namespace");
    expect(byProperty).toHaveBeenCalledWith("sourceFile");
    expect(Filters.and).toHaveBeenCalledWith(nsClause, srcClause);
    // ...and the combined filter was handed to a single native deleteMany.
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith(andFilter);

    vi.doUnmock("weaviate-client");
  });
});

// ---------------------------------------------------------------------------
// pinecone — listPaginated(prefix) -> collected ids -> batched deleteMany;
//            and a no-match -> no deleteMany case; pod-index -> clear error.
// ---------------------------------------------------------------------------
describe("PineconeAdapter.deleteBySource", () => {
  function pineconeConfig(): VectorStoreConfig {
    return { VECTOR_STORE: "pinecone", PINECONE_API_KEY: "k", PINECONE_INDEX: "i" };
  }

  /** Build a mocked Pinecone module whose namespace-scoped index we control. */
  function mockPinecone(index: Record<string, unknown>): void {
    const namespaced = index;
    const indexHandle = { namespace: vi.fn(() => namespaced) };
    const client = { index: vi.fn(() => indexHandle) };
    const Pinecone = vi.fn(() => client);
    vi.doMock("@pinecone-database/pinecone", () => ({ Pinecone }));
  }

  it("lists by ${ns}::${sourceFile}:: prefix across pages then deleteMany the collected ids", async () => {
    const listPaginated = vi
      .fn()
      // page 1 -> two ids + a continuation token
      .mockResolvedValueOnce({
        vectors: [{ id: `${NS}::${SOURCE}::1::0` }, { id: `${NS}::${SOURCE}::1::1` }],
        pagination: { next: "tok" },
      })
      // page 2 -> one id, no token => stop
      .mockResolvedValueOnce({
        vectors: [{ id: `${NS}::${SOURCE}::2::0` }],
        pagination: {},
      });
    const deleteMany = vi.fn().mockResolvedValue(undefined);

    mockPinecone({ listPaginated, deleteMany });
    vi.resetModules();
    const { PineconeAdapter: FreshAdapter } = await import("../pinecone");

    const adapter = new FreshAdapter(pineconeConfig(), NS);
    await adapter.deleteBySource(SOURCE);

    const expectedPrefix = `${NS}::${SOURCE}::`;
    expect(listPaginated).toHaveBeenNthCalledWith(1, { prefix: expectedPrefix, paginationToken: undefined });
    expect(listPaginated).toHaveBeenNthCalledWith(2, { prefix: expectedPrefix, paginationToken: "tok" });
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(deleteMany).toHaveBeenCalledWith({
      ids: [`${NS}::${SOURCE}::1::0`, `${NS}::${SOURCE}::1::1`, `${NS}::${SOURCE}::2::0`],
    });

    vi.doUnmock("@pinecone-database/pinecone");
  });

  it("skips deleteMany entirely when the prefix matches no ids (idempotent no-op)", async () => {
    const listPaginated = vi.fn().mockResolvedValue({ vectors: [], pagination: {} });
    const deleteMany = vi.fn().mockResolvedValue(undefined);

    mockPinecone({ listPaginated, deleteMany });
    vi.resetModules();
    const { PineconeAdapter: FreshAdapter } = await import("../pinecone");

    const adapter = new FreshAdapter(pineconeConfig(), NS);
    await adapter.deleteBySource(SOURCE);

    expect(listPaginated).toHaveBeenCalledTimes(1);
    expect(deleteMany).not.toHaveBeenCalled();

    vi.doUnmock("@pinecone-database/pinecone");
  });

  it("batches deleteMany at the 1000-id cap for an oversized source", async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => `${NS}::${SOURCE}::0::${i}`);
    const listPaginated = vi.fn().mockResolvedValue({
      vectors: ids.map((id) => ({ id })),
      pagination: {},
    });
    const deleteMany = vi.fn().mockResolvedValue(undefined);

    mockPinecone({ listPaginated, deleteMany });
    vi.resetModules();
    const { PineconeAdapter: FreshAdapter } = await import("../pinecone");

    const adapter = new FreshAdapter(pineconeConfig(), NS);
    await adapter.deleteBySource(SOURCE);

    // 1500 ids -> two batches: 1000 + 500.
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect((deleteMany.mock.calls[0][0] as { ids: string[] }).ids).toHaveLength(1000);
    expect((deleteMany.mock.calls[1][0] as { ids: string[] }).ids).toHaveLength(500);

    vi.doUnmock("@pinecone-database/pinecone");
  });

  it("throws a CONFIG-pointing error on a pod-based index lacking listPaginated", async () => {
    const deleteMany = vi.fn().mockResolvedValue(undefined);
    // listPaginated absent => pod-based index.
    mockPinecone({ deleteMany });
    vi.resetModules();
    const { PineconeAdapter: FreshAdapter } = await import("../pinecone");

    const adapter = new FreshAdapter(pineconeConfig(), NS);
    await expect(adapter.deleteBySource(SOURCE)).rejects.toThrow(/CONFIG\.md#vector-store/);
    expect(deleteMany).not.toHaveBeenCalled();

    vi.doUnmock("@pinecone-database/pinecone");
  });
});
