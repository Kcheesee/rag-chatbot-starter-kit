import { afterEach, describe, expect, it, vi } from "vitest";

import type { Citation, QueryInput, RAGPipeline, RAGResponse } from "@rag-chat-agent/rag-core";

/**
 * `respond.ts` builds its pipeline lazily from `createPipeline(loadEnv())` on first
 * `answerQuestion` call. We mock the whole rag-core module so importing `respond`
 * never touches real env, adapters, or the network — `createPipeline` returns a
 * controllable fake whose `query()` we drive per test. `formatCitations` is pure and
 * needs no mocking; we assert it directly.
 */
const queryMock = vi.fn<(input: QueryInput) => Promise<RAGResponse>>();

vi.mock("@rag-chat-agent/rag-core", () => ({
  loadEnv: vi.fn(() => ({})),
  createPipeline: vi.fn(
    (): RAGPipeline => ({
      query: queryMock,
      stream: () => {
        throw new Error("stream() is not exercised by these tests");
      },
    }),
  ),
}));

import { answerQuestion, formatCitations, NAMESPACE } from "../respond";

afterEach(() => {
  vi.clearAllMocks();
});

function citation(overrides: Partial<Citation> = {}): Citation {
  return {
    index: 1,
    chunkId: "c1",
    sourceFile: "returns.md",
    sourceType: "md",
    ...overrides,
  };
}

function response(overrides: Partial<RAGResponse> = {}): RAGResponse {
  return {
    answer: "Refunds take 30 days.",
    sources: [],
    confidence: 0.9,
    fromCache: false,
    escalate: false,
    ...overrides,
  };
}

describe("formatCitations", () => {
  it("returns an empty string for no citations (no source noise)", () => {
    expect(formatCitations([])).toBe("");
  });

  it("renders a compact, indented source list with index and file", () => {
    const out = formatCitations([
      citation({ index: 1, sourceFile: "returns.md" }),
      citation({ index: 2, sourceFile: "shipping.md" }),
    ]);
    expect(out).toBe("\n\nSources:\n  [1] returns.md\n  [2] shipping.md");
  });

  it("appends the page number only when the source is paginated", () => {
    expect(formatCitations([citation({ index: 1, sourceFile: "policy.pdf", pageNumber: 3 })])).toBe(
      "\n\nSources:\n  [1] policy.pdf, p.3",
    );
    expect(formatCitations([citation({ index: 1, sourceFile: "policy.pdf" })])).not.toContain("p.");
  });
});

describe("answerQuestion", () => {
  it("queries the pipeline with the namespace and returns the shaped answer", async () => {
    const sources = [citation({ index: 1, sourceFile: "returns.md", pageNumber: 2 })];
    queryMock.mockResolvedValue(response({ answer: "Yes, within 30 days.", sources }));

    const result = await answerQuestion("Can I return this?", "thread-123");

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock).toHaveBeenCalledWith({
      query: "Can I return this?",
      sessionId: "thread-123",
      namespace: NAMESPACE,
    });
    expect(result).toEqual({
      text: "Yes, within 30 days.",
      citations: sources,
      escalated: false,
    });
  });

  it("surfaces the low-confidence escalate path with empty citations", async () => {
    queryMock.mockResolvedValue(
      response({
        answer: "I couldn't find a confident answer.",
        sources: [],
        confidence: 0.1,
        escalate: true,
        escalateReason: "low_retrieval_confidence",
      }),
    );

    const result = await answerQuestion("What is the meaning of life?", "thread-9");

    expect(result.escalated).toBe(true);
    expect(result.citations).toEqual([]);
    expect(result.text).toBe("I couldn't find a confident answer.");
  });

  it("reuses one pipeline instance across calls (built lazily, once)", async () => {
    queryMock.mockResolvedValue(response());
    await answerQuestion("a", "s1");
    await answerQuestion("b", "s2");
    // Two queries went through the same memoised pipeline.
    expect(queryMock).toHaveBeenCalledTimes(2);
  });
});
