/**
 * Sitemap crawler loader.
 *
 * Many sites publish a `sitemap.xml` listing every indexable page. Rather than
 * make the operator enumerate URLs by hand, this loader reads that sitemap and
 * fetches each `<loc>` as a URL document — turning "ingest this site" into a
 * one-line config entry.
 *
 * WHY a hard cap: a sitemap can list tens of thousands of URLs, and crawling all
 * of them would silently fan out into a huge, slow, potentially abusive crawl.
 * We cap at `maxUrls` (default 100) and make the cap an explicit, configurable
 * constructor argument so truncation is a deliberate operator choice, not a
 * surprise. To crawl more, raise the cap on purpose.
 */

import type {
  DocumentLoader,
  RAGDocument,
} from "@rag-chat-agent/rag-core";

// WHY reuse: a sitemap page is just a URL document. Sharing the url loader's
// fetch+extract helper keeps page-text behaviour (HTML stripping, title
// extraction, redirects) identical across both loaders.
import { fetchPageText } from "./url";

/**
 * Minimal structural shape of the slice of cheerio we touch.
 *
 * WHY structural (not the package's own types): cheerio is a lazy, optional
 * dependency imported only inside `load()`. Typing it structurally here lets us
 * stay strict and `any`-free without forcing the package's types into the build
 * graph of every consumer that never crawls a sitemap.
 */
interface CheerioTextNode {
  text(): string;
}

interface CheerioSelection {
  /** Iterate matched nodes. We only need the per-element callback's node. */
  each(fn: (index: number, element: CheerioTextNode) => void): void;
}

interface CheerioRoot {
  /** jQuery-style selector; we only ever select `"loc"`. */
  (selector: string): CheerioSelection;
}

interface CheerioModule {
  load(content: string, options: { xmlMode: boolean }): CheerioRoot;
}

/**
 * Crawls a sitemap and yields one {@link RAGDocument} per reachable page.
 *
 * `sourceType` is `"url"` — crawled pages are URL documents, indistinguishable
 * downstream from those produced by the single-URL loader.
 */
export class SitemapLoader implements DocumentLoader {
  // WHY "url": these are URL documents. The fact that they were *discovered*
  // via a sitemap is an ingestion detail, irrelevant to chunking/citation.
  public readonly sourceType = "url";

  /**
   * @param sitemapUrl - Absolute URL of the `sitemap.xml` to read.
   * @param maxUrls - Hard cap on pages crawled. Default 100; see class JSDoc for
   *   why this exists and why it is explicit.
   */
  public constructor(
    private readonly sitemapUrl: string,
    private readonly maxUrls: number = 100,
  ) {}

  public async load(): Promise<RAGDocument[]> {
    const response = await fetch(this.sitemapUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch sitemap ${this.sitemapUrl}: ${response.status} ${response.statusText}. See CONFIG.md#ingestion.`,
      );
    }
    const xml = await response.text();

    // WHY lazy dynamic import: cheerio is heavyweight and only needed when a
    // sitemap is actually crawled. Importing it at call time keeps it off the
    // hot path for every other loader.
    const cheerio = (await import("cheerio")) as unknown as CheerioModule;
    // WHY xmlMode: a sitemap is XML, not HTML. Without it cheerio's HTML parser
    // lowercases/auto-closes tags and can mangle `<loc>` extraction.
    const $ = cheerio.load(xml, { xmlMode: true });

    const urls: string[] = [];
    $("loc").each((_index, element) => {
      const url = element.text().trim();
      if (url.length > 0) {
        urls.push(url);
      }
    });

    if (urls.length === 0) {
      throw new Error(
        `No <loc> URLs found in sitemap ${this.sitemapUrl}; is it a valid sitemap.xml? See CONFIG.md#ingestion.`,
      );
    }

    // Explicit truncation — see class JSDoc.
    const capped = urls.slice(0, this.maxUrls);

    const documents: RAGDocument[] = [];
    for (const url of capped) {
      try {
        const { text, title } = await fetchPageText(url);
        documents.push({
          content: text,
          metadata: {
            sourceFile: url,
            sourceType: "url",
            // `heading` is optional; only set when the page exposed a title.
            ...(title === undefined ? {} : { heading: title }),
          },
        });
      } catch {
        // WHY swallow-and-continue: one dead link (404, timeout, TLS error)
        // must not abort the whole crawl. We skip the bad page and keep going so
        // a single broken URL never costs us the rest of the site.
        continue;
      }
    }

    return documents;
  }
}
