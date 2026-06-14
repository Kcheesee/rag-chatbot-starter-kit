/**
 * DOCX document loader.
 *
 * Extracts the plain-text body of a Word `.docx` file via `mammoth`, discarding all
 * formatting. We deliberately use `extractRawText` (not `convertToHtml`): the
 * downstream chunker works on prose, so structural HTML would be noise it would only
 * have to strip again.
 *
 * WHY a single document: `.docx` has no intrinsic page model (pagination is a render
 * concern decided by the viewer, not stored in the file), so — unlike the PDF loader —
 * there is nothing to split on here. We emit one `RAGDocument`; the semantic chunker
 * downstream is responsible for slicing it.
 */

import type {
  DocumentLoader,
  DocumentMetadata,
  RAGDocument,
} from "@rag-chat-agent/rag-core";

/**
 * Minimal structural view of the slice of `mammoth` we touch.
 *
 * WHY local + structural: `mammoth` is an optional, lazily-imported dependency, so it
 * is intentionally absent from this package's `dependencies` and from the typecheck
 * graph. Declaring the shape here (rather than importing its types) lets `tsc` pass
 * without the package installed, while still giving us a fully-typed call site — no
 * `any` leaks across the import boundary.
 *
 * `mammoth` is published as a CommonJS module (`export = mammoth`), so under
 * `esModuleInterop` the dynamic `import()` namespace carries the callable object on its
 * `default` property.
 */
interface MammothResult {
  /** Extracted plain text. Paragraphs are separated by two newlines. */
  readonly value: string;
}

interface MammothModule {
  extractRawText(input: { readonly path: string }): Promise<MammothResult>;
}

interface MammothImport {
  readonly default: MammothModule;
}

/**
 * Collapse runs of blank lines down to a single blank line.
 *
 * WHY: `mammoth` ends every paragraph with two newlines and empty paragraphs in the
 * source compound into long blank gaps. Normalising to at most one blank line keeps
 * paragraph boundaries (which the chunker uses) while preventing whitespace from
 * inflating token counts and skewing chunk sizing.
 */
function collapseBlankLines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Loads a Word `.docx` file as a single plain-text {@link RAGDocument}. */
export class DocxLoader implements DocumentLoader {
  public readonly sourceType = "docx";

  public constructor(private readonly filePath: string) {}

  public async load(): Promise<RAGDocument[]> {
    let mammoth: MammothModule;
    try {
      // WHY lazy dynamic import: keeps `mammoth` (and its zip/XML transitive deps) off
      // the critical path for callers that never touch DOCX, and out of the static
      // dependency graph so the package typechecks without it installed.
      const imported = (await import("mammoth")) as unknown as MammothImport;
      mammoth = imported.default;
    } catch {
      throw new Error(
        'The "mammoth" package is required to load .docx files but is not installed. ' +
          "Install it with `npm install mammoth`. See CONFIG.md#ingestion.",
      );
    }

    let value: string;
    try {
      const result = await mammoth.extractRawText({ path: this.filePath });
      value = result.value;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Failed to extract text from DOCX "${this.filePath}": ${reason}. ` +
          "See CONFIG.md#ingestion.",
      );
    }

    const content = collapseBlankLines(value);

    const metadata: DocumentMetadata = {
      sourceFile: this.filePath,
      sourceType: this.sourceType,
    };

    return [{ content, metadata }];
  }
}
