import { describe, expect, it } from "vitest";

import { loadEnv } from "../env";
import { CohereReranker, HybridReranker, createReranker } from "../rerank/reranker";

describe("createReranker", () => {
  it("defaults to the dependency-free hybrid reranker", () => {
    expect(createReranker(loadEnv({}))).toBeInstanceOf(HybridReranker);
  });

  it("returns the Cohere reranker when RERANKER=cohere and a key is configured", () => {
    const env = loadEnv({ RERANKER: "cohere", COHERE_API_KEY: "test-key" });
    expect(createReranker(env)).toBeInstanceOf(CohereReranker);
  });

  it("throws when RERANKER=cohere but COHERE_API_KEY is missing", () => {
    expect(() => createReranker(loadEnv({ RERANKER: "cohere" }))).toThrow(/COHERE_API_KEY/);
  });
});
