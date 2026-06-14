/**
 * Loader registry: turn a `--source` + `--type` request into concrete loaders.
 *
 * File types (pdf/md/docx/txt) expand a directory into one loader per matching
 * file; URL/sitemap/Notion/Confluence each produce a single loader. This is the
 * one place that knows how to map sources to loaders — the ingest CLI and the
 * admin ingest API both go through it.
 */

import { readdir, stat } from "node:fs/promises";
import { extname, join } from "node:path";

import type { DocumentLoader } from "@rag-chat-agent/rag-core";

import { PdfLoader } from "./pdf";
import { MarkdownLoader } from "./markdown";
import { DocxLoader } from "./docx";
import { TextLoader } from "./text";
import { UrlLoader } from "./url";
import { SitemapLoader } from "./sitemap";
import { NotionLoader } from "./notion";
import { ConfluenceLoader } from "./confluence";

/** Every source type the ingest CLI accepts. */
export type LoaderSourceType =
  | "pdf"
  | "md"
  | "docx"
  | "txt"
  | "url"
  | "sitemap"
  | "notion"
  | "confluence";

/** Credentials for the API-backed sources, supplied from validated env. */
export interface LoaderCredentials {
  notionToken?: string;
  confluence?: { baseUrl: string; email: string; apiToken: string };
}

const FILE_TYPES = new Set<LoaderSourceType>(["pdf", "md", "docx", "txt"]);

const EXT_TO_TYPE: Record<string, LoaderSourceType> = {
  ".pdf": "pdf",
  ".md": "md",
  ".mdx": "md",
  ".markdown": "md",
  ".docx": "docx",
  ".txt": "txt",
};

function fileLoaderFor(type: LoaderSourceType, path: string): DocumentLoader | null {
  switch (type) {
    case "pdf":
      return new PdfLoader(path);
    case "md":
      return new MarkdownLoader(path);
    case "docx":
      return new DocxLoader(path);
    case "txt":
      return new TextLoader(path);
    default:
      return null;
  }
}

/** Recursively list every file under a directory. */
async function walkDir(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await walkDir(full)));
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Build the loaders for a source + requested types. */
export async function createLoaders(
  source: string,
  types: LoaderSourceType[],
  creds: LoaderCredentials = {},
): Promise<DocumentLoader[]> {
  const requested = new Set(types);

  // Single-source, non-file types.
  if (requested.has("url")) return [new UrlLoader(source)];
  if (requested.has("sitemap")) return [new SitemapLoader(source)];
  if (requested.has("notion")) {
    if (!creds.notionToken) {
      throw new Error("Notion ingestion requires NOTION_TOKEN. See CONFIG.md#ingestion.");
    }
    return [new NotionLoader({ token: creds.notionToken, pageOrDatabaseId: source })];
  }
  if (requested.has("confluence")) {
    if (!creds.confluence) {
      throw new Error(
        "Confluence ingestion requires CONFLUENCE base URL, email, and API token. " +
          "See CONFIG.md#ingestion.",
      );
    }
    return [new ConfluenceLoader({ ...creds.confluence, pageIdOrSpaceKey: source })];
  }

  // File-based: `source` is a directory or a single file path.
  const fileTypes = [...requested].filter((t) => FILE_TYPES.has(t));
  if (fileTypes.length === 0) {
    throw new Error(`No loader available for types: ${types.join(", ")}. See CONFIG.md#ingestion.`);
  }

  const info = await stat(source);
  const paths = info.isDirectory() ? await walkDir(source) : [source];
  const loaders: DocumentLoader[] = [];
  for (const path of paths) {
    const type = EXT_TO_TYPE[extname(path).toLowerCase()];
    if (type && requested.has(type)) {
      const loader = fileLoaderFor(type, path);
      if (loader) loaders.push(loader);
    }
  }

  if (loaders.length === 0) {
    throw new Error(
      `No files matching types [${fileTypes.join(", ")}] found at ${source}. ` +
        "See CONFIG.md#ingestion.",
    );
  }
  return loaders;
}
