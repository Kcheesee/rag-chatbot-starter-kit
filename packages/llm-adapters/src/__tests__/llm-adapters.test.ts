import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createEmbeddingAdapter,
  createLLMAdapter,
  modelSupportsSampling,
  samplingParams,
  type EmbeddingConfig,
  type LLMConfig,
} from "../index";
import { CohereEmbeddingAdapter } from "../embeddings/cohere";
import { VoyageEmbeddingAdapter } from "../embeddings/voyage";

function llm(overrides: Partial<LLMConfig>): LLMConfig {
  return { LLM_PROVIDER: "anthropic", LLM_MODEL: "claude-sonnet-4-6", ...overrides };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("modelSupportsSampling", () => {
  it("allows sampling on Sonnet 4.6 and older", () => {
    expect(modelSupportsSampling("claude-sonnet-4-6")).toBe(true);
    expect(modelSupportsSampling("gpt-4o")).toBe(true);
  });

  it("blocks sampling on Opus 4.7+/4.8 and Fable 5, including provider-prefixed ids", () => {
    expect(modelSupportsSampling("claude-opus-4-8")).toBe(false);
    expect(modelSupportsSampling("claude-opus-4-7")).toBe(false);
    expect(modelSupportsSampling("claude-fable-5")).toBe(false);
    expect(modelSupportsSampling("anthropic.claude-opus-4-8")).toBe(false);
  });
});

describe("samplingParams", () => {
  it("attaches temperature only when the model accepts it", () => {
    expect(samplingParams("claude-sonnet-4-6", 0.2)).toEqual({ temperature: 0.2 });
    expect(samplingParams("claude-opus-4-8", 0.2)).toEqual({});
    expect(samplingParams("claude-sonnet-4-6", undefined)).toEqual({});
  });
});

describe("createLLMAdapter", () => {
  it("routes each provider to an adapter with the matching id", () => {
    expect(createLLMAdapter(llm({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k" })).provider).toBe(
      "anthropic",
    );
    expect(createLLMAdapter(llm({ LLM_PROVIDER: "openai", OPENAI_API_KEY: "k" })).provider).toBe(
      "openai",
    );
    expect(
      createLLMAdapter(
        llm({ LLM_PROVIDER: "bedrock", AWS_REGION: "us-east-1", AWS_BEDROCK_MODEL: "anthropic.claude-sonnet-4-6" }),
      ).provider,
    ).toBe("bedrock");
    expect(
      createLLMAdapter(
        llm({
          LLM_PROVIDER: "vertex",
          VERTEX_MODEL: "claude-sonnet-4-6",
          VERTEX_PROJECT: "p",
          VERTEX_LOCATION: "us-central1",
        }),
      ).provider,
    ).toBe("vertex");
    expect(
      createLLMAdapter(
        llm({
          LLM_PROVIDER: "azure-openai",
          AZURE_OPENAI_ENDPOINT: "https://x.openai.azure.com",
          AZURE_OPENAI_DEPLOYMENT: "gpt-4o",
        }),
      ).provider,
    ).toBe("azure-openai");
    expect(
      createLLMAdapter(
        llm({
          LLM_PROVIDER: "internal",
          INTERNAL_LLM_ENDPOINT: "https://x/v1",
          INTERNAL_LLM_MODEL: "m",
          INTERNAL_LLM_CERT_PATH: "/c",
          INTERNAL_LLM_KEY_PATH: "/k",
        }),
      ).provider,
    ).toBe("internal");
  });

  it("throws a clear error when a required key is missing", () => {
    expect(() => createLLMAdapter(llm({ LLM_PROVIDER: "anthropic" }))).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("enforces a GovCloud region for bedrock-gov", () => {
    expect(() =>
      createLLMAdapter(
        llm({ LLM_PROVIDER: "bedrock-gov", AWS_REGION: "us-east-1", AWS_BEDROCK_MODEL: "anthropic.claude-sonnet-4-6" }),
      ),
    ).toThrow(/GovCloud/i);
    expect(
      createLLMAdapter(
        llm({
          LLM_PROVIDER: "bedrock-gov",
          AWS_REGION: "us-gov-west-1",
          AWS_BEDROCK_MODEL: "anthropic.claude-sonnet-4-6",
        }),
      ).provider,
    ).toBe("bedrock-gov");
  });

  it("enforces a .azure.us host for azure-gov (and rejects spoofed hosts)", () => {
    const gov = (endpoint: string) =>
      llm({ LLM_PROVIDER: "azure-gov", AZURE_OPENAI_ENDPOINT: endpoint, AZURE_OPENAI_DEPLOYMENT: "gpt-4o" });

    // Commercial endpoint rejected.
    expect(() => createLLMAdapter(gov("https://x.openai.azure.com"))).toThrow(/azure\.us/i);
    // Substring-spoofed host rejected (host suffix check, not includes()).
    expect(() => createLLMAdapter(gov("https://evil.azure.us.attacker.com"))).toThrow(/azure\.us/i);
    // Genuine Government endpoint accepted.
    expect(createLLMAdapter(gov("https://x.openai.azure.us")).provider).toBe("azure-gov");
  });
});

describe("createEmbeddingAdapter", () => {
  function emb(overrides: Partial<EmbeddingConfig>): EmbeddingConfig {
    return { EMBEDDING_PROVIDER: "openai", EMBEDDING_MODEL: "text-embedding-3-small", ...overrides };
  }

  it("routes providers and resolves known dimensions", () => {
    const a = createEmbeddingAdapter(emb({ EMBEDDING_PROVIDER: "openai", OPENAI_API_KEY: "k" }));
    expect(a.provider).toBe("openai");
    expect(a.dimensions).toBe(1536);

    const v = createEmbeddingAdapter(
      emb({ EMBEDDING_PROVIDER: "voyage", EMBEDDING_MODEL: "voyage-3", VOYAGE_API_KEY: "k" }),
    );
    expect(v.provider).toBe("voyage");
    expect(v.dimensions).toBe(1024);
  });
});

describe("embedding adapters (mocked HTTP)", () => {
  it("CohereEmbeddingAdapter parses the v2 embed response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ embeddings: { float: [[0.1, 0.2], [0.3, 0.4]] } }),
      }),
    );
    const adapter = new CohereEmbeddingAdapter({
      EMBEDDING_PROVIDER: "cohere",
      EMBEDDING_MODEL: "embed-english-v3.0",
      COHERE_API_KEY: "k",
    });
    const vectors = await adapter.embed(["a", "b"]);
    expect(vectors).toEqual([[0.1, 0.2], [0.3, 0.4]]);
  });

  it("Cohere sends search_document for indexing and search_query for queries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ embeddings: { float: [[0.1]] } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new CohereEmbeddingAdapter({
      EMBEDDING_PROVIDER: "cohere",
      EMBEDDING_MODEL: "embed-english-v3.0",
      COHERE_API_KEY: "k",
    });

    await adapter.embed(["doc"]); // default → document
    await adapter.embedOne("the question", "query");

    const bodyOf = (call: number): { input_type?: string } =>
      JSON.parse((fetchMock.mock.calls[call]![1] as { body: string }).body);
    expect(bodyOf(0).input_type).toBe("search_document");
    expect(bodyOf(1).input_type).toBe("search_query");
  });

  it("VoyageEmbeddingAdapter sorts by index and throws on HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: [{ embedding: [9], index: 1 }, { embedding: [8], index: 0 }] }),
      }),
    );
    const adapter = new VoyageEmbeddingAdapter({
      EMBEDDING_PROVIDER: "voyage",
      EMBEDDING_MODEL: "voyage-3",
      VOYAGE_API_KEY: "k",
    });
    expect(await adapter.embed(["a", "b"])).toEqual([[8], [9]]);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, statusText: "Unauthorized", text: async () => "bad key" }),
    );
    await expect(adapter.embed(["a"])).rejects.toThrow(/Voyage embed failed/);
  });

  it("returns [] for an empty input without calling the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new VoyageEmbeddingAdapter({
      EMBEDDING_PROVIDER: "voyage",
      EMBEDDING_MODEL: "voyage-3",
      VOYAGE_API_KEY: "k",
    });
    expect(await adapter.embed([])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
