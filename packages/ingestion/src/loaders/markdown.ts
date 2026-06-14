/**
 * Markdown / MDX loader.
 *
 * The loader returns the raw markdown verbatim — heading structure is preserved in
 * the text and turned into chunk metadata by the chunker (which segments on headings
 * and never splits mid-heading). Keeping that logic in one place (the chunker) means
 * every source type benefits from it, not just Markdown.
 */

import { readFile } from "node:fs/promises";

import type { DocumentLoader, RAGDocument } from "@rag-chat-agent/rag-core";

export class MarkdownLoader implements DocumentLoader {
  readonly sourceType = "md";

  constructor(private readonly filePath: string) {}

  async load(): Promise<RAGDocument[]> {
    const content = await readFile(this.filePath, "utf8");
    return [{ content, metadata: { sourceFile: this.filePath, sourceType: this.sourceType } }];
  }
}
