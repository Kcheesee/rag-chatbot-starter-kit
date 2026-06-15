import { readFile, stat } from "node:fs/promises";

import type { DocumentLoader, RAGDocument, DocumentMetadata } from "@rag-chat-agent/rag-core";

/** Default cap on a PDF read into memory (10 MB), matching the loader fetch cap. */
const DEFAULT_MAX_BYTES = 10_000_000;

/**
 * Minimal structural shape of `pdf-parse`'s result, declared locally so typecheck
 * does NOT require the dependency to be installed. We model only the slice we read
 * (`text` + `numpages`); `info` stays `unknown` because we never inspect it here.
 */
interface PdfParseResult {
  readonly text: string;
  readonly numpages: number;
  readonly info?: unknown;
}

/**
 * Minimal structural type for the `pdf-parse` default export. The v1 package is CJS
 * (`module.exports = pdf`), so under ESM the function lands on the namespace's
 * `.default`. We type the callable here rather than importing the dep's own types,
 * keeping the package's `@types` footprint at zero until install time.
 */
type PdfParseFn = (
  dataBuffer: Buffer,
  options?: Record<string, unknown>,
) => Promise<PdfParseResult>;

/** Collapse runs of 2+ blank lines into a single blank line and trim edges. */
function collapseBlankLines(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Loads a single PDF file into one whole-document {@link RAGDocument}.
 *
 * WHY whole-document (not per-page): `pdf-parse` concatenates all page text into one
 * string and does not hand back reliable, stable per-page boundaries — splitting on its
 * internal page separators is brittle and silently mis-attributes content. Downstream
 * semantic chunking already segments the text, so emitting the full document is both
 * simpler and more accurate than faking page numbers. `pageNumber` is therefore left
 * unset on the metadata.
 *
 * WHY lazy dynamic import: `pdf-parse` pulls in `pdfjs` and is only needed when a PDF is
 * actually loaded. Importing it at module top-level would cost every consumer of this
 * package (including non-PDF code paths) the load. Deferring to `load()` keeps the
 * import out of the hot path and lets the rest of the package typecheck and run without
 * the dependency present.
 */
export class PdfLoader implements DocumentLoader {
  public readonly sourceType = "pdf";

  /**
   * @param filePath - Path to the PDF on disk.
   * @param maxBytes - Hard cap on the file size read into memory. `pdf-parse` buffers the
   *   entire file, so an unbounded read is a memory-exhaustion vector; defaults to 10 MB.
   */
  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number = DEFAULT_MAX_BYTES,
  ) {}

  /**
   * Read the PDF from disk and extract its text as one document.
   *
   * WHY `.default`: `pdf-parse` v1 is CommonJS (`module.exports = pdf`), so the ESM
   * dynamic import exposes the callable as `.default`, not as the namespace itself.
   */
  public async load(): Promise<RAGDocument[]> {
    // Size-gate BEFORE buffering the file or importing the parser — a too-large PDF must
    // fail fast, not after it has already been read into memory.
    await this.assertWithinSizeCap();

    let pdf: PdfParseFn;
    try {
      const mod = (await import("pdf-parse")) as unknown as { default: PdfParseFn };
      pdf = mod.default;
    } catch (cause) {
      throw new Error(
        `PdfLoader: failed to load the "pdf-parse" dependency — install it to ingest PDFs. See CONFIG.md#ingestion.`,
        { cause },
      );
    }

    let dataBuffer: Buffer;
    try {
      dataBuffer = await readFile(this.filePath);
    } catch (cause) {
      throw new Error(
        `PdfLoader: failed to read PDF at "${this.filePath}". See CONFIG.md#ingestion.`,
        { cause },
      );
    }

    let result: PdfParseResult;
    try {
      result = await pdf(dataBuffer);
    } catch (cause) {
      throw new Error(
        `PdfLoader: failed to parse PDF at "${this.filePath}". See CONFIG.md#ingestion.`,
        { cause },
      );
    }

    const content = collapseBlankLines(result.text);
    const metadata: DocumentMetadata = {
      sourceFile: this.filePath,
      sourceType: this.sourceType,
    };

    return [{ content, metadata }];
  }

  /** Reject a file larger than `maxBytes` before any of it is read into memory. */
  private async assertWithinSizeCap(): Promise<void> {
    let size: number;
    try {
      ({ size } = await stat(this.filePath));
    } catch (cause) {
      throw new Error(
        `PdfLoader: failed to stat PDF at "${this.filePath}". See CONFIG.md#ingestion.`,
        { cause },
      );
    }
    if (size > this.maxBytes) {
      throw new Error(
        `PdfLoader: "${this.filePath}" is ${size} bytes, over the ${this.maxBytes}-byte ` +
          `cap (INGEST_MAX_BYTES). See CONFIG.md#ingestion.`,
      );
    }
  }
}
