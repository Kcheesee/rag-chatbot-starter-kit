import { readFile } from "node:fs/promises";

import type { DocumentLoader, RAGDocument, DocumentMetadata } from "@rag-chat-agent/rag-core";

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

  constructor(private readonly filePath: string) {}

  /**
   * Read the PDF from disk and extract its text as one document.
   *
   * WHY `.default`: `pdf-parse` v1 is CommonJS (`module.exports = pdf`), so the ESM
   * dynamic import exposes the callable as `.default`, not as the namespace itself.
   */
  public async load(): Promise<RAGDocument[]> {
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
}
