import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DocxLoader,
  MarkdownLoader,
  PdfLoader,
  TextLoader,
  UrlLoader,
  chunkDocuments,
  createLoaders,
  createPIIRedactor,
  estimateTokens,
  PresidioRedactor,
} from "../index";
import { applySpans } from "../pii/apply";

const fixture = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});

describe("chunkDocuments", () => {
  const longText = "Sentence number one is here. ".repeat(40);

  it("splits a long document into multiple chunks with full, hashed metadata", () => {
    const chunks = chunkDocuments(
      [{ content: longText, metadata: { sourceFile: "/a.txt", sourceType: "txt" } }],
      { chunkSize: 30, chunkOverlap: 5, namespace: "acme" },
    );
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(chunk.metadata.contentHash).toBe(chunk.contentHash);
      expect(chunk.metadata.namespace).toBe("acme");
      expect(chunk.metadata.ingestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(chunk.text.length).toBeLessThanOrEqual(30 * 4 * 2);
    }
    // Deterministic, collision-free ids.
    expect(new Set(chunks.map((c) => c.id)).size).toBe(chunks.length);
  });

  it("attributes the nearest markdown heading to each chunk", () => {
    const md =
      "# Title\n\nIntro paragraph.\n\n## Returns\n\nReturn within 30 days.\n\n## Shipping\n\nShips in 2 days.";
    const chunks = chunkDocuments(
      [{ content: md, metadata: { sourceFile: "/h.md", sourceType: "md" } }],
      { chunkSize: 200, chunkOverlap: 0, namespace: "acme" },
    );
    const returns = chunks.find((c) => c.text.includes("Return within"));
    const shipping = chunks.find((c) => c.text.includes("Ships in"));
    expect(returns?.metadata.heading).toBe("Returns");
    expect(shipping?.metadata.heading).toBe("Shipping");
  });
});

describe("PII redaction", () => {
  it("applySpans replaces detected spans with labelled placeholders", () => {
    const text = "Email a@b.com or call 555-123-4567.";
    const result = applySpans(text, [
      { start: 6, end: 13, type: "EMAIL_ADDRESS" },
      { start: 22, end: 34, type: "PHONE_NUMBER" },
    ]);
    expect(result.text).toBe("Email [REDACTED_EMAIL_ADDRESS] or call [REDACTED_PHONE_NUMBER].");
    expect(result.entitiesFound).toEqual(
      expect.arrayContaining([
        { type: "EMAIL_ADDRESS", count: 1 },
        { type: "PHONE_NUMBER", count: 1 },
      ]),
    );
  });

  it("PresidioRedactor maps analyzer spans and redacts (mocked HTTP)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => [{ entity_type: "US_SSN", start: 10, end: 21, score: 0.99 }],
      }),
    );
    const redactor = new PresidioRedactor("http://presidio:5002");
    const result = await redactor.redact("My SSN is 123-45-6789 thanks.");
    expect(result.text).toBe("My SSN is [REDACTED_SSN] thanks.");
    expect(result.entitiesFound).toEqual([{ type: "SSN", count: 1 }]);
  });

  it("PresidioRedactor drops detections below the confidence threshold", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        // One high-confidence hit and one low-confidence false positive.
        json: async () => [
          { entity_type: "US_SSN", start: 10, end: 21, score: 0.99 },
          { entity_type: "PERSON", start: 0, end: 2, score: 0.2 },
        ],
      }),
    );
    const redactor = new PresidioRedactor("http://presidio:5002", 0.6);
    const result = await redactor.redact("My SSN is 123-45-6789 thanks.");
    // The 0.2-score PERSON span ("My") is skipped; only the SSN is redacted.
    expect(result.text).toBe("My SSN is [REDACTED_SSN] thanks.");
    expect(result.entitiesFound).toEqual([{ type: "SSN", count: 1 }]);
  });

  it("createPIIRedactor returns null when disabled and a redactor when enabled", () => {
    expect(
      createPIIRedactor({ PII_REDACTION_ENABLED: false, PII_REDACTION_PROVIDER: "presidio" }),
    ).toBeNull();
    expect(
      createPIIRedactor({ PII_REDACTION_ENABLED: true, PII_REDACTION_PROVIDER: "presidio" }),
    ).toBeInstanceOf(PresidioRedactor);
  });
});

describe("file loaders", () => {
  it("TextLoader reads a plain-text fixture", async () => {
    const [doc] = await new TextLoader(fixture("sample.txt")).load();
    expect(doc?.content).toContain("Acme Corporation");
    expect(doc?.metadata.sourceType).toBe("txt");
  });

  it("MarkdownLoader reads a markdown fixture verbatim", async () => {
    const [doc] = await new MarkdownLoader(fixture("sample.md")).load();
    expect(doc?.content).toContain("## Returns");
    expect(doc?.metadata.sourceType).toBe("md");
  });

  it("PdfLoader rejects a file over the byte cap before reading it", async () => {
    // A 1-byte cap is exceeded by any real fixture, so the size gate trips before the
    // pdf-parse dependency is even imported.
    await expect(new PdfLoader(fixture("sample.txt"), 1).load()).rejects.toThrow(/over the 1-byte cap/);
  });

  it("DocxLoader rejects a file over the byte cap before reading it", async () => {
    await expect(new DocxLoader(fixture("sample.txt"), 1).load()).rejects.toThrow(/over the 1-byte cap/);
  });
});

describe("createLoaders registry", () => {
  it("routes a URL source to a UrlLoader", async () => {
    const loaders = await createLoaders("https://example.com/docs", ["url"]);
    expect(loaders).toHaveLength(1);
    expect(loaders[0]).toBeInstanceOf(UrlLoader);
  });

  it("expands a directory of files by extension", async () => {
    const loaders = await createLoaders(fixture(""), ["md", "txt"]);
    // The fixtures dir contains sample.md + sample.txt.
    expect(loaders.length).toBeGreaterThanOrEqual(2);
  });

  it("requires credentials for Notion", async () => {
    await expect(createLoaders("page-id", ["notion"])).rejects.toThrow(/NOTION_TOKEN/);
  });
});
