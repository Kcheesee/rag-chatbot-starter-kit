/**
 * Recursive, semantic-boundary-aware chunker.
 *
 * Strategy: split text into the largest natural atoms that fit the budget
 * (paragraph → sentence → word → hard slice), then greedily merge adjacent atoms
 * up to the size budget, carrying a configurable overlap between chunks. For
 * Markdown, the document is first segmented on headings so a chunk never straddles
 * a heading boundary and every chunk records its nearest heading — which both
 * improves retrieval and lets the UI label citations ("Source 3: Returns, …").
 *
 * Token budgets are approximated at ~4 characters/token. This avoids a tokenizer
 * dependency; tune CHUNK_SIZE for your content (FAQs chunk well small, long-form
 * PDFs larger) — see the README's customisation guide.
 */

import type { RAGDocument } from "@rag-chat-agent/rag-core";
import type { ChunkMetadata } from "@rag-chat-agent/vector-adapters";

import type { Chunk, ChunkOptions } from "./types";
import { sha256Hex } from "./hash";

const CHARS_PER_TOKEN = 4;

/** Approximate token count for budgeting and ingest summaries. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/** Split markdown into sections keyed by their nearest heading. */
function segmentMarkdown(content: string): Array<{ heading?: string; body: string }> {
  const sections: Array<{ heading?: string; body: string }> = [];
  let heading: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join("\n").trim();
    if (body.length > 0) sections.push(heading ? { heading, body } : { body });
    buffer = [];
  };

  for (const line of content.split("\n")) {
    const match = /^#{1,6}\s+(.*)$/.exec(line);
    if (match) {
      flush();
      heading = match[1]?.trim();
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections.length > 0 ? sections : [{ body: content.trim() }];
}

/** Split a string into the largest natural pieces that each fit `maxChars`. */
function splitToAtoms(text: string, maxChars: number): string[] {
  const atoms: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const para = paragraph.trim();
    if (para.length === 0) continue;
    if (para.length <= maxChars) {
      atoms.push(para);
      continue;
    }
    // Paragraph too big — fall to sentences.
    for (const sentence of para.split(/(?<=[.!?])\s+/)) {
      const sent = sentence.trim();
      if (sent.length === 0) continue;
      if (sent.length <= maxChars) {
        atoms.push(sent);
        continue;
      }
      // Sentence too big — fall to words, then a hard slice as a last resort.
      for (const word of sent.split(/\s+/)) {
        if (word.length <= maxChars) {
          atoms.push(word);
        } else {
          for (let i = 0; i < word.length; i += maxChars) atoms.push(word.slice(i, i + maxChars));
        }
      }
    }
  }
  return atoms;
}

/** Tail of `text` ~`overlapChars` long, starting at a word boundary when possible. */
function overlapTail(text: string, overlapChars: number): string {
  if (overlapChars <= 0 || text.length <= overlapChars) return text;
  const slice = text.slice(text.length - overlapChars);
  const spaceIdx = slice.indexOf(" ");
  return spaceIdx > 0 ? slice.slice(spaceIdx + 1) : slice;
}

/** Greedily merge atoms into chunks up to `maxChars`, carrying overlap forward. */
function mergeAtoms(atoms: string[], maxChars: number, overlapChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const atom of atoms) {
    const candidate = current.length > 0 ? `${current}\n\n${atom}` : atom;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current.length > 0) chunks.push(current);
    const overlap = overlapTail(current, overlapChars);
    current = overlap.length > 0 ? `${overlap}\n\n${atom}` : atom;
    if (current.length > maxChars) {
      // An atom that is itself oversized even after splitting — emit standalone.
      chunks.push(current);
      current = "";
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Chunk a set of loaded documents into embed-ready `Chunk`s with full metadata.
 * Chunk ids are deterministic (`namespace::sourceFile::page::index`) so re-ingesting
 * a source overwrites its prior chunks rather than duplicating them.
 */
export function chunkDocuments(docs: RAGDocument[], options: ChunkOptions): Chunk[] {
  const maxChars = Math.max(64, options.chunkSize * CHARS_PER_TOKEN);
  const overlapChars = Math.max(0, Math.min(options.chunkOverlap * CHARS_PER_TOKEN, maxChars - 1));
  const ingestedAt = new Date().toISOString();
  const out: Chunk[] = [];

  for (const doc of docs) {
    const sections =
      doc.metadata.sourceType === "md"
        ? segmentMarkdown(doc.content)
        : [{ heading: doc.metadata.heading, body: doc.content }];

    let chunkIndex = 0;
    for (const section of sections) {
      const pieces = mergeAtoms(splitToAtoms(section.body, maxChars), maxChars, overlapChars);
      for (const piece of pieces) {
        const text = piece.trim();
        if (text.length === 0) continue;

        const contentHash = sha256Hex(text);
        const metadata: ChunkMetadata = {
          sourceFile: doc.metadata.sourceFile,
          sourceType: doc.metadata.sourceType,
          chunkIndex,
          contentHash,
          ingestedAt,
          namespace: options.namespace,
          ...(doc.metadata.pageNumber !== undefined ? { pageNumber: doc.metadata.pageNumber } : {}),
          ...(section.heading ? { heading: section.heading } : {}),
        };
        const page = doc.metadata.pageNumber ?? 0;
        out.push({
          id: `${options.namespace}::${doc.metadata.sourceFile}::${page}::${chunkIndex}`,
          text,
          metadata,
          contentHash,
        });
        chunkIndex += 1;
      }
    }
  }
  return out;
}
