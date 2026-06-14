/** Plain-text loader (.txt and any UTF-8 text file). */

import { readFile } from "node:fs/promises";

import type { DocumentLoader, RAGDocument } from "@rag-chat-agent/rag-core";

export class TextLoader implements DocumentLoader {
  readonly sourceType = "txt";

  constructor(private readonly filePath: string) {}

  async load(): Promise<RAGDocument[]> {
    const content = await readFile(this.filePath, "utf8");
    return [{ content, metadata: { sourceFile: this.filePath, sourceType: this.sourceType } }];
  }
}
