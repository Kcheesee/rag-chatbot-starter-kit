import { describe, expect, it } from "vitest";

import {
  ChromaAdapter,
  PgVectorAdapter,
  PineconeAdapter,
  WeaviateAdapter,
  createVectorAdapter,
  fromFlatMetadata,
  sanitizeNamespace,
  toFlatMetadata,
  toSearchResult,
  toStoredChunk,
  type ChunkMetadata,
  type VectorStoreConfig,
} from "../index";

const META: ChunkMetadata = {
  sourceFile: "/docs/returns.md",
  sourceType: "md",
  chunkIndex: 2,
  pageNumber: 5,
  heading: "Returns Policy",
  contentHash: "abc123",
  ingestedAt: "2026-06-13T00:00:00.000Z",
  namespace: "acme",
};

describe("metadata mapping", () => {
  it("round-trips ChunkMetadata through flat scalars", () => {
    const flat = toFlatMetadata(META);
    // Every value must be a scalar (store-safe).
    for (const value of Object.values(flat)) {
      expect(["string", "number", "boolean"]).toContain(typeof value);
    }
    expect(fromFlatMetadata(flat)).toEqual(META);
  });

  it("omits undefined optionals and rebuilds without them", () => {
    const { pageNumber: _p, heading: _h, ...required } = META;
    const flat = toFlatMetadata(required as ChunkMetadata);
    expect(flat).not.toHaveProperty("pageNumber");
    expect(flat).not.toHaveProperty("heading");
    const rebuilt = fromFlatMetadata(flat);
    expect(rebuilt.pageNumber).toBeUndefined();
    expect(rebuilt.heading).toBeUndefined();
  });

  it("builds StoredChunk/SearchResult with contentHash surfaced", () => {
    const stored = toStoredChunk("c1", "hello", toFlatMetadata(META));
    expect(stored).toMatchObject({ id: "c1", text: "hello", contentHash: "abc123" });

    const result = toSearchResult("c1", "hello", toFlatMetadata(META), 0.91);
    expect(result.score).toBe(0.91);
    expect(result.contentHash).toBe("abc123");
  });
});

describe("sanitizeNamespace", () => {
  it("returns already-safe names unchanged", () => {
    expect(sanitizeNamespace("acme")).toBe("acme");
    expect(sanitizeNamespace("acme_corp")).toBe("acme_corp");
    expect(sanitizeNamespace("default")).toBe("default");
  });

  it("falls back to 'default' for an empty namespace", () => {
    expect(sanitizeNamespace("")).toBe("default");
  });

  it("appends a stable hash when sanitisation is lossy, keeping a readable prefix", () => {
    expect(sanitizeNamespace("acme-corp")).toMatch(/^acme_corp_[0-9a-f]{8}$/);
    expect(sanitizeNamespace("a/b c")).toMatch(/^a_b_c_[0-9a-f]{8}$/);
    // Stable across calls.
    expect(sanitizeNamespace("acme-corp")).toBe(sanitizeNamespace("acme-corp"));
  });

  it("is INJECTIVE: inputs that used to collide now map to distinct names", () => {
    // The whole point of the fix — "acme-corp" and "acme_corp" must not share a store.
    expect(sanitizeNamespace("acme-corp")).not.toBe(sanitizeNamespace("acme_corp"));
  });
});

describe("createVectorAdapter", () => {
  function cfg(overrides: Partial<VectorStoreConfig>): VectorStoreConfig {
    return { VECTOR_STORE: "chroma", ...overrides };
  }

  it("routes each store to its adapter", () => {
    expect(createVectorAdapter(cfg({ VECTOR_STORE: "chroma" }))).toBeInstanceOf(ChromaAdapter);
    expect(
      createVectorAdapter(cfg({ VECTOR_STORE: "pinecone", PINECONE_API_KEY: "k", PINECONE_INDEX: "i" })),
    ).toBeInstanceOf(PineconeAdapter);
    expect(
      createVectorAdapter(cfg({ VECTOR_STORE: "pgvector", PGVECTOR_HOST: "localhost" })),
    ).toBeInstanceOf(PgVectorAdapter);
    expect(
      createVectorAdapter(cfg({ VECTOR_STORE: "weaviate", WEAVIATE_URL: "http://localhost:8080" })),
    ).toBeInstanceOf(WeaviateAdapter);
  });

  it("fails fast when a store's required settings are missing", () => {
    expect(() => createVectorAdapter(cfg({ VECTOR_STORE: "pinecone" }))).toThrow(/PINECONE_API_KEY/);
    expect(() => createVectorAdapter(cfg({ VECTOR_STORE: "pgvector" }))).toThrow(/PGVECTOR_HOST/);
    expect(() => createVectorAdapter(cfg({ VECTOR_STORE: "weaviate" }))).toThrow(/WEAVIATE_URL/);
  });
});

describe("namespace scoping", () => {
  it("returns a distinct, same-type adapter without mutating the original", () => {
    const base = new ChromaAdapter({ VECTOR_STORE: "chroma" });
    const scoped = base.namespace("acme");
    expect(scoped).toBeInstanceOf(ChromaAdapter);
    expect(scoped).not.toBe(base);
  });
});
