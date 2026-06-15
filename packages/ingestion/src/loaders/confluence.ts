/**
 * Confluence document loader.
 *
 * Pulls pages out of a Confluence Cloud instance via the REST API and turns each
 * one into a {@link RAGDocument}. Two modes share one loader: a single page (by id)
 * or every page in a space (by space key, paginated).
 *
 * WHY raw `fetch` over an SDK: the Confluence read surface we need is two GET
 * endpoints plus Basic auth — pulling in the official client (and its transitive
 * weight) to call them would be all cost and no benefit. The repo's runtime floor
 * (Node 20+) ships a global `fetch`, so there is nothing to install or polyfill.
 *
 * WHY cheerio, lazily and structurally: Confluence stores page bodies as
 * "storage format" — XHTML laced with custom macro tags. Stripping that to plain
 * text needs an HTML parser, but cheerio is a heavyweight, optional dependency we
 * do not want in every ingestion image or in the typecheck dependency set. We load
 * it via dynamic `import` inside `load()` and type it against a minimal local
 * interface, keeping `tsc --noEmit` green even when cheerio is not installed — it
 * only has to exist at runtime, where this loader actually runs.
 */

import type { DocumentLoader, RAGDocument, DocumentMetadata } from "@rag-chat-agent/rag-core";

import { assertUrlAllowed, type LoaderSecurity } from "./security";

/**
 * Minimal structural view of the slice of cheerio's API we touch.
 *
 * WHY hand-rolled instead of `import type { CheerioAPI } from "cheerio"`: a type-only
 * import would still force the package to be present at typecheck time. Declaring just
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
  /** Parse an HTML/XHTML string into a callable, jQuery-like API. */
  load(html: string): CheerioApi;
}

/**
 * Structural shapes of the slices of the Confluence REST responses we read. Declared
 * locally (not imported from an `@types` package) so the loader stays `any`-free
 * without dragging Confluence's type definitions into the build.
 */
interface ConfluencePage {
  readonly id: string;
  readonly title: string;
  readonly body?: { readonly storage?: { readonly value?: string } };
}

/** `GET /content?spaceKey=...` — a page of results plus REST-driven pagination links. */
interface ConfluencePageList {
  readonly results: readonly ConfluencePage[];
  /**
   * `_links.next` is a RELATIVE path (e.g. `/rest/api/content?...&start=50`) the API
   * hands back when more results exist; its absence is how we know to stop.
   */
  readonly _links?: { readonly next?: string; readonly base?: string };
}

/** Selectors whose content is markup/scripting, never readable prose. */
const NON_CONTENT_SELECTORS = "script, style";

/**
 * Collapse arbitrary markup-derived whitespace into clean, embeddable text.
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
 * Loads Confluence pages as {@link RAGDocument}s.
 *
 * `sourceType` is `"confluence"`; each document carries `sourceFile: "confluence:<id>"`
 * so citations point back at the originating page, and `heading: <page title>`.
 */
export class ConfluenceLoader implements DocumentLoader {
  public readonly sourceType = "confluence";

  /**
   * @param opts.baseUrl - Instance root, e.g. `https://acme.atlassian.net` (no trailing
   *   `/wiki`; this loader appends the `/wiki/rest/api/...` path).
   * @param opts.email - Atlassian account email, used as the Basic-auth username.
   * @param opts.apiToken - Atlassian API token, used as the Basic-auth password.
   * @param opts.pageIdOrSpaceKey - A page id (single-page mode) or a space key
   *   (space mode); interpreted per `isSpaceKey`.
   * @param opts.isSpaceKey - When `true`, treat `pageIdOrSpaceKey` as a space key and
   *   crawl the whole space; otherwise fetch the one page by id.
   * @param sec - SSRF policy applied to every request URL (see {@link getJson}). Defaults
   *   to the safe deny-by-default policy so a `baseUrl` pointing at an internal/metadata
   *   host is rejected unless the operator explicitly opts into private networks.
   */
  public constructor(
    private readonly opts: {
      baseUrl: string;
      email: string;
      apiToken: string;
      pageIdOrSpaceKey: string;
      isSpaceKey?: boolean;
    },
    private readonly sec: LoaderSecurity = {},
  ) {}

  /**
   * Build the HTTP Basic `Authorization` header.
   *
   * WHY `Buffer.from(...).toString("base64")`: Confluence Cloud authenticates API
   * tokens as Basic `email:token`. We encode on the server (Node), so `Buffer` is the
   * direct, dependency-free path — no `btoa`/`TextEncoder` dance required.
   */
  private authHeader(): string {
    const encoded = Buffer.from(`${this.opts.email}:${this.opts.apiToken}`).toString("base64");
    return `Basic ${encoded}`;
  }

  public async load(): Promise<RAGDocument[]> {
    // Lazy, structurally-typed import: keeps cheerio out of the typecheck dependency set
    // and off the hot path of every loader that does not touch Confluence. See file JSDoc.
    const { load } = (await import("cheerio")) as unknown as CheerioModule;

    const pages = this.opts.isSpaceKey
      ? await this.fetchSpacePages()
      : [await this.fetchSinglePage()];

    const documents: RAGDocument[] = [];
    for (const page of pages) {
      try {
        const storage = page.body?.storage?.value ?? "";
        const $ = load(storage);
        // Drop scripting/style chrome so it never bleeds into the readable text.
        $(NON_CONTENT_SELECTORS).remove();
        const content = normalizeWhitespace($("body").text() || $("*").text());

        const metadata: DocumentMetadata = {
          sourceFile: `confluence:${page.id}`,
          sourceType: this.sourceType,
          heading: page.title,
        };
        documents.push({ content, metadata });
      } catch {
        // WHY swallow-and-continue: one malformed page body must not abort the whole
        // space crawl. We skip the bad page and keep going so a single broken page never
        // costs us the rest of the space. The initial fetch (creds/url) still throws.
        continue;
      }
    }

    return documents;
  }

  /**
   * Fetch one page by id, with its storage-format body expanded.
   *
   * @throws if the request fails (bad credentials, wrong base URL, missing page) — a
   *   single-page load has nothing to fall back to, so the failure is surfaced.
   */
  private async fetchSinglePage(): Promise<ConfluencePage> {
    const url = `${this.opts.baseUrl}/wiki/rest/api/content/${this.opts.pageIdOrSpaceKey}?expand=body.storage`;
    const res = await this.getJson<ConfluencePage>(url);
    return res;
  }

  /**
   * Fetch every page in the space, following `_links.next` until exhausted.
   *
   * WHY follow the cursor (not just bump `start`): the API owns the page size and
   * cursor; trusting its `next` link is more robust than reconstructing offsets and
   * survives server-side limit changes. The FIRST request throwing (bad creds/url) is
   * intentional — it is how a misconfigured loader fails loudly; later-page failures
   * would, however, lose already-collected pages, so they too propagate here.
   */
  private async fetchSpacePages(): Promise<ConfluencePage[]> {
    const pages: ConfluencePage[] = [];
    // Initial query: storage body expanded, capped page size; the API paginates the rest.
    let next: string | undefined =
      `${this.opts.baseUrl}/wiki/rest/api/content?spaceKey=${this.opts.pageIdOrSpaceKey}&expand=body.storage&limit=50`;

    while (next !== undefined) {
      const list: ConfluencePageList = await this.getJson<ConfluencePageList>(next);
      pages.push(...list.results);

      const rel: string | undefined = list._links?.next;
      // WHY resolve against `baseUrl/wiki`: `_links.next` is a path relative to the
      // Confluence app root (`/rest/api/...`), which sits under `/wiki`. Re-anchoring it
      // there yields the absolute URL `fetch` needs for the follow-up request.
      next = rel === undefined ? undefined : `${this.opts.baseUrl}/wiki${rel}`;
    }

    return pages;
  }

  /**
   * GET a Confluence URL and parse its JSON body, authenticated with Basic auth.
   *
   * Every URL — the initial request AND each server-provided `_links.next` page — is run
   * through {@link assertUrlAllowed} first, applying the same SSRF gate (scheme / allowlist
   * / private-IP + DNS-rebinding checks) the url/sitemap loaders use. Unlike those, this
   * carries a Basic-auth header that `guardedFetch` cannot forward, so we validate the URL
   * here and then fetch directly. WHY this matters: a misconfigured `CONFLUENCE_BASE_URL`
   * (e.g. `http://169.254.169.254/…`) would otherwise turn the loader into an SSRF sink.
   *
   * @throws if the URL is disallowed by the SSRF policy, on transport failure, or on any
   *   non-2xx status — messages end in the config pointer so a misconfigured instance is
   *   diagnosable from the error alone.
   */
  private async getJson<T>(url: string): Promise<T> {
    await assertUrlAllowed(url, this.sec);

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: this.authHeader(), Accept: "application/json" },
      });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `ConfluenceLoader: failed to reach "${url}": ${reason}. See CONFIG.md#ingestion.`,
      );
    }

    if (!res.ok) {
      throw new Error(
        `ConfluenceLoader: request to "${url}" failed: HTTP ${res.status} ${res.statusText}. See CONFIG.md#ingestion.`,
      );
    }

    return (await res.json()) as T;
  }
}
