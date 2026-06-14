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
import { assertPathAllowed, type LoaderSecurity } from "./security";

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

/**
 * Build the loaders for a source + requested types.
 *
 * @param sec - Optional security policy. For url/sitemap it is threaded into the loaders
 *   (SSRF gate); for file types its `ingestRoot` confines every resolved path. Optional
 *   and defaulted to `{}` so existing 3-arg callers keep compiling unchanged.
 */
export async function createLoaders(
  source: string,
  types: LoaderSourceType[],
  creds: LoaderCredentials = {},
  sec: LoaderSecurity = {},
): Promise<DocumentLoader[]> {
  const requested = new Set(types);

  // Single-source, non-file types.
  if (requested.has("url")) return [new UrlLoader(source, sec)];
  if (requested.has("sitemap")) return [new SitemapLoader(source, undefined, sec)];
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

  // Containment first: the `stat` target itself must be inside ingestRoot (when set),
  // so a malicious `--source ../../etc` is rejected before we ever touch the filesystem
  // tree. With no ingestRoot this is a passthrough that just normalizes to absolute.
  const safeSource = assertPathAllowed(source, sec.ingestRoot);

  const info = await stat(safeSource);
  const paths = info.isDirectory() ? await walkDir(safeSource) : [safeSource];
  const loaders: DocumentLoader[] = [];
  for (const path of paths) {
    const type = EXT_TO_TYPE[extname(path).toLowerCase()];
    if (type && requested.has(type)) {
      // Re-check EACH file: walkDir can surface symlinks pointing outside the root, so
      // every individual path is re-validated (and we use the returned real path).
      const safePath = assertPathAllowed(path, sec.ingestRoot);
      const loader = fileLoaderFor(type, safePath);
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
