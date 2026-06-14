/**
 * URL document loader: fetches a web page and extracts its readable text.
 *
 * WHY this shape: ingestion runs in many environments (dev, CI, federal GovCloud)
 * where shipping a full HTML parser into every image is undesirable. cheerio is a
 * heavyweight, optional dependency, so we (a) load it lazily via dynamic `import`
 * and (b) type it STRUCTURALLY against a minimal local interface. That keeps
 * `tsc --noEmit` green even when cheerio is not installed in the current package —
 * the dependency only has to exist at runtime, where the loader is actually used.
 *
 * WHY a standalone helper: the sitemap loader fans out over many URLs and needs the
 * exact same fetch+extract behaviour per page. `fetchPageText` is the single source
 * of truth for that, and the `UrlLoader` class is a thin one-document wrapper over it.
 */

import type { DocumentLoader, RAGDocument, DocumentMetadata } from "@rag-chat-agent/rag-core";

/**
 * Minimal structural view of the slice of cheerio's API we use.
 *
 * WHY hand-rolled instead of `import type { CheerioAPI } from "cheerio"`: a type-only
 * import would still make typecheck require the package to be present. Declaring just
 * `remove()` and `text()` on a callable `$` matches cheerio v1's real surface
 * (`load(html)` returns a callable that yields selections) while staying dependency-free.
 */
interface CheerioSelection {
  /** Detach the matched elements (and their descendants) from the tree. */
  remove(): unknown;
  /** Concatenated text content of the matched elements. */
  text(): string;
}
type CheerioApi = (selector: string) => CheerioSelection;
interface CheerioModule {
  /** Parse an HTML string into a callable, jQuery-like API. */
  load(html: string): CheerioApi;
}

/** Selectors whose content is chrome/scripting, never readable prose. */
const NON_CONTENT_SELECTORS = "script, style, noscript, nav, header, footer, svg";

/**
 * Collapse arbitrary HTML-derived whitespace into clean, embeddable text.
 *
 * WHY: cheerio's `.text()` preserves the source's incidental newlines and indentation,
 * which bloats chunks and pollutes embeddings. We squeeze runs of inline whitespace to
 * single spaces but keep paragraph-ish breaks (blank lines) so the chunker still has
 * sensible boundaries to split on.
 */
function normalizeWhitespace(raw: string): string {
  return raw
    .replace(/[ \t\r\f\v]+/g, " ") // collapse inline runs, but not newlines yet
    .replace(/ *\n */g, "\n") // trim spaces hugging each newline
    .replace(/\n{3,}/g, "\n\n") // cap consecutive blank lines at one
    .trim();
}

/**
 * Fetch a URL and return its readable text plus the page `<title>`.
 *
 * Shared by {@link UrlLoader} and the sitemap loader so both extract text identically.
 *
 * @throws if the fetch fails or the server responds with a non-2xx status.
 */
export async function fetchPageText(url: string): Promise<{ text: string; title?: string }> {
  // Global `fetch` is available on Node 20+ (the repo's runtime floor), so no polyfill.
  let res: Response;
  try {
    res = await fetch(url);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to fetch "${url}": ${reason}. See CONFIG.md#ingestion.`);
  }

  if (!res.ok) {
    throw new Error(
      `Failed to fetch "${url}": HTTP ${res.status} ${res.statusText}. See CONFIG.md#ingestion.`,
    );
  }

  const html = await res.text();

  // Lazy, structurally-typed import: keeps cheerio out of the typecheck dependency set.
  const { load } = (await import("cheerio")) as unknown as CheerioModule;
  const $ = load(html);

  // Title is read BEFORE stripping chrome — it lives in <head>, which is untouched anyway,
  // but ordering here documents intent and is robust to future selector tweaks.
  const rawTitle = $("title").text().trim();
  const title = rawTitle.length > 0 ? rawTitle : undefined;

  // Drop scripting/navigation chrome so it never bleeds into the readable text.
  $(NON_CONTENT_SELECTORS).remove();

  // `<body>` holds the rendered page; fall back to the document root for fragments/
  // malformed pages that cheerio didn't wrap in a body.
  const bodyText = $("body").text();
  const text = normalizeWhitespace(bodyText.length > 0 ? bodyText : $("*").text());

  return { text, title };
}

/**
 * Loads a single web page as one {@link RAGDocument}.
 *
 * WHY one document per URL: a page is the smallest natural unit of authorship; chunking
 * into retrievable pieces is the downstream chunker's job, not the loader's.
 */
export class UrlLoader implements DocumentLoader {
  readonly sourceType = "url";

  constructor(private readonly url: string) {}

  async load(): Promise<RAGDocument[]> {
    const { text, title } = await fetchPageText(this.url);

    const metadata: DocumentMetadata = {
      sourceFile: this.url,
      sourceType: this.sourceType,
    };
    // Only attach a heading when the page actually declared a title — an empty string
    // would be a misleading "heading" in citations.
    if (title !== undefined) metadata.heading = title;

    return [{ content: text, metadata }];
  }
}
