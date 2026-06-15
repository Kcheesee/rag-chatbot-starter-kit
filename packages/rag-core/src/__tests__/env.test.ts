import { describe, expect, it } from "vitest";

import { loadEnv } from "../env";

describe("loadEnv — defaults & coercion", () => {
  it("applies defaults for an empty environment", () => {
    const env = loadEnv({});
    expect(env.LLM_PROVIDER).toBe("anthropic");
    expect(env.LLM_MODEL).toBe("claude-sonnet-4-6");
    expect(env.VECTOR_STORE).toBe("chroma");
    expect(env.MIN_RETRIEVAL_CONFIDENCE).toBe(0.7);
    expect(env.DEPLOYMENT_MODE).toBe("standard");
    expect(env.RERANKER).toBe("hybrid");
    expect(env.PRESIDIO_MIN_CONFIDENCE).toBe(0);
  });

  it("coerces numbers and booleans from strings", () => {
    const env = loadEnv({ TOP_K_RESULTS: "15", CACHE_ENABLED: "false", TEMPERATURE: "0.5" });
    expect(env.TOP_K_RESULTS).toBe(15);
    expect(env.CACHE_ENABLED).toBe(false);
    expect(env.TEMPERATURE).toBe(0.5);
  });

  it("treats empty-string values as unset (so defaults apply)", () => {
    const env = loadEnv({ CHROMA_URL: "", VECTOR_NAMESPACE_PREFIX: "" });
    expect(env.CHROMA_URL).toBeUndefined();
    expect(env.VECTOR_NAMESPACE_PREFIX).toBe("rag_chunks");
  });
});

describe("loadEnv — federal & GovCloud invariants", () => {
  const federalBase = {
    DEPLOYMENT_MODE: "federal",
    LLM_PROVIDER: "bedrock-gov",
    AWS_REGION: "us-gov-west-1",
    AWS_BEDROCK_MODEL: "anthropic.claude-sonnet-4-6",
    VECTOR_STORE: "pgvector",
    PGVECTOR_HOST: "db.us-gov-west-1.rds.amazonaws.com",
    PGVECTOR_SSL: "require",
    AUTH_ENABLED: "true",
    AUTH_PROVIDER: "saml",
  };

  it("accepts a well-formed federal configuration", () => {
    expect(() => loadEnv(federalBase)).not.toThrow();
  });

  it("rejects pinecone under federal mode", () => {
    expect(() => loadEnv({ ...federalBase, VECTOR_STORE: "pinecone" })).toThrow(/pinecone/i);
  });

  it("requires PGVECTOR_SSL=require under federal mode", () => {
    expect(() => loadEnv({ ...federalBase, PGVECTOR_SSL: "prefer" })).toThrow(/PGVECTOR_SSL/);
  });

  it("requires AUTH_ENABLED under federal mode", () => {
    expect(() => loadEnv({ ...federalBase, AUTH_ENABLED: "false" })).toThrow(/AUTH_ENABLED/);
  });

  it("requires a GovCloud region for bedrock-gov", () => {
    expect(() => loadEnv({ ...federalBase, AWS_REGION: "us-east-1" })).toThrow(/GovCloud/i);
  });
});
