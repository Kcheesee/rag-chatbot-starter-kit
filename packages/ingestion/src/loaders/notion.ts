/**
 * Notion document loader.
 *
 * Pulls a Notion database or a single Notion page into {@link RAGDocument}s — one
 * per page — by walking the block tree and concatenating the plain text of every
 * supported block.
 *
 * Why the id is treated as "database OR page": callers configure ingestion with a
 * single `pageOrDatabaseId` and we don't make them tell us which kind it is. We
 * optimistically `databases.query` it; if Notion rejects that (the id is a page,
 * not a database) we fall back to treating it as one page. This keeps config to a
 * single value and mirrors how a human pastes "the URL of the thing to ingest".
 *
 * Why the SDK is imported lazily and typed structurally: `@notionhq/client` is an
 * optional dependency only deployments that actually ingest from Notion install.
 * Importing it (or its types) at module scope would couple this package's
 * type-check and bundle to a dep most builds never need. So we `await import(...)`
 * inside `load()` and describe the exact surface we touch with local interfaces,
 * casting the module — no `any`, and `tsc` stays green without the package present.
 *
 * SDK version target: this file is written against the **legacy 2.x line**
 * (`@notionhq/client@^2.2.16`), where `databases.query({ database_id })` and
 * `blocks.children.list({ block_id })` exist with the cursor-based pagination the
 * spec describes. See the caveat in the package notes: v5.x renamed database
 * querying to `dataSources.query({ data_source_id })` and dropped
 * `databases.query`, so this loader's structural calls would not resolve against
 * a v5 client.
 */

import type {
  DocumentLoader,
  DocumentMetadata,
  RAGDocument,
} from "@rag-chat-agent/rag-core";

/**
 * Structural shapes of the slice of the Notion SDK we actually call.
 *
 * Declared locally rather than imported from `@notionhq/client` so the lazy
 * `import()` stays the only coupling to the package — the type-check does not
 * need it installed. These mirror the 2.x `Client` surface closely enough to keep
 * every call site honest without reaching for `any`.
 */

/** A single span of rich text; only `plain_text` is load-bearing for us. */
interface NotionRichText {
  plain_text: string;
}

/**
 * Per-block-type payload. Notion nests the rich text under a key named after the
 * block `type` (e.g. `paragraph.rich_text`), so a block is an open record whose
 * relevant entry carries `{ rich_text }`. Modelled as an index signature of
 * optional `{ rich_text }` bags so we can look up `block[block.type]` structurally.
 */
interface NotionBlockTypeData {
  rich_text?: NotionRichText[];
}

/** A block as returned by `blocks.children.list`. */
interface NotionBlock {
  id: string;
  type: string;
  has_children: boolean;
  /** Type-keyed payloads (`paragraph`, `heading_1`, `code`, ...). */
  [key: string]: NotionBlockTypeData | string | boolean | undefined;
}

/** A page (or database row) as returned by `databases.query` / used as a page id. */
interface NotionPage {
  id: string;
  /** Present on `page` objects; absent on partial responses. */
  properties?: Record<string, NotionProperty>;
}

/** A page property; we only ever read `title` rich text for the heading. */
interface NotionProperty {
  type: string;
  title?: NotionRichText[];
}

/** Shared cursor-pagination envelope for list/query responses. */
interface NotionPaginatedResponse<T> {
  results: T[];
  has_more: boolean;
  next_cursor: string | null;
}

/** The exact `Client` methods this loader invokes. */
interface NotionClientLike {
  databases: {
    query(args: {
      database_id: string;
      start_cursor?: string;
    }): Promise<NotionPaginatedResponse<NotionPage>>;
  };
  blocks: {
    children: {
      list(args: {
        block_id: string;
        start_cursor?: string;
      }): Promise<NotionPaginatedResponse<NotionBlock>>;
    };
  };
}

/** Module shape: the named `Client` constructor taking `{ auth }`. */
interface NotionModule {
  Client: new (options: { auth: string }) => NotionClientLike;
}

/**
 * Block types whose `rich_text` we extract. Restricted to text-bearing leaf/
 * container blocks; structural-only blocks (dividers, tables, columns, embeds,
 * child_page/database refs, ...) carry no `rich_text` and are skipped. This is the
 * allow-list the spec enumerates.
 */
const TEXT_BLOCK_TYPES = new Set<string>([
  "paragraph",
  "heading_1",
  "heading_2",
  "heading_3",
  "bulleted_list_item",
  "numbered_list_item",
  "to_do",
  "quote",
  "callout",
  "code",
]);

/**
 * How deep to recurse into nested block children.
 *
 * Why bounded: Notion block trees can be arbitrarily deep (toggles inside toggles,
 * nested lists), and `has_children` recursion is otherwise unbounded — a single
 * malformed/cyclic-looking page could fan out into thousands of requests. 10 levels
 * comfortably covers real documents while capping worst-case request fan-out.
 */
const MAX_BLOCK_DEPTH = 10;

/**
 * Loads Notion pages as RAG documents.
 *
 * One instance targets one `pageOrDatabaseId`. Construct it, call {@link load}.
 * Pages that error mid-walk are skipped rather than failing the whole batch — a
 * single archived/permission-denied page should not sink an ingest run.
 */
export class NotionLoader implements DocumentLoader {
  readonly sourceType = "notion";

  /**
   * @param opts.token - Notion integration token (`secret_...` or an OAuth access
   *   token), passed straight to `new Client({ auth })`.
   * @param opts.pageOrDatabaseId - Id of either a database or a single page; the
   *   kind is detected at load time (see class docs).
   */
  constructor(
    private readonly opts: { token: string; pageOrDatabaseId: string },
  ) {}

  /**
   * Resolve the configured id to page ids, walk each page's blocks, and return one
   * document per page.
   */
  async load(): Promise<RAGDocument[]> {
    let mod: NotionModule;
    try {
      // Cast the dynamic import to our structural module shape: the package's own
      // types are intentionally not imported (see file header), so we assert the
      // minimal surface we rely on. `unknown` first to avoid an unchecked cast.
      mod = (await import("@notionhq/client")) as unknown as NotionModule;
    } catch {
      throw new Error(
        "The '@notionhq/client' package is required for the Notion loader but " +
          "could not be loaded. Install it with `npm i @notionhq/client`. " +
          "See CONFIG.md#ingestion.",
      );
    }

    const client = new mod.Client({ auth: this.opts.token });
    const pages = await this.resolvePageIds(client);

    const documents: RAGDocument[] = [];
    for (const page of pages) {
      try {
        documents.push(await this.loadPage(client, page.id, page.title));
      } catch {
        // Skip pages we can't read (archived, revoked share, transient error):
        // one bad page must not abort the whole ingest run.
        continue;
      }
    }
    return documents;
  }

  /**
   * Resolve the configured id into the set of page ids to ingest.
   *
   * Try it as a database first — `databases.query` paginated via `has_more` /
   * `next_cursor` yields every row's page id. If the query throws (the id is a
   * page, not a database; or it isn't shared as a database), fall back to treating
   * the id itself as a single page id. We can't pre-detect the kind cheaply, so we
   * let the database attempt be the probe.
   */
  private async resolvePageIds(
    client: NotionClientLike,
  ): Promise<Array<{ id: string; title?: string }>> {
    try {
      const pages: Array<{ id: string; title?: string }> = [];
      let cursor: string | undefined;
      do {
        const response = await client.databases.query({
          database_id: this.opts.pageOrDatabaseId,
          ...(cursor !== undefined ? { start_cursor: cursor } : {}),
        });
        // Each database row carries its own title in a `title`-typed property — the
        // correct, non-mis-attributed source for the document heading.
        for (const page of response.results) {
          pages.push(titleOf(page) ? { id: page.id, title: titleOf(page) } : { id: page.id });
        }
        // `next_cursor` is non-null exactly when `has_more` is true; coalesce the
        // `null` terminal to `undefined` to drop `start_cursor` on the final call.
        cursor = response.has_more
          ? (response.next_cursor ?? undefined)
          : undefined;
      } while (cursor !== undefined);
      return pages;
    } catch {
      // Not a database (or not shared as one) — treat the id as a single page.
      // A standalone page's title isn't exposed via blocks, so heading stays absent.
      return [{ id: this.opts.pageOrDatabaseId }];
    }
  }

  /** Walk one page's blocks into a single {@link RAGDocument}. */
  private async loadPage(
    client: NotionClientLike,
    pageId: string,
    title: string | undefined,
  ): Promise<RAGDocument> {
    const content = await this.collectBlockText(client, pageId, 0);

    const metadata: DocumentMetadata = {
      sourceFile: `notion:${pageId}`,
      sourceType: "notion",
      // Attach `heading` only when the database row carried a non-empty title, so
      // the optional metadata field stays absent rather than an empty string.
      ...(title ? { heading: title } : {}),
    };
    return { content, metadata };
  }

  /**
   * Depth-first collect plain text from a block subtree.
   *
   * Pages `blocks.children.list` via `has_more` / `next_cursor`, extracts
   * `plain_text` from every {@link TEXT_BLOCK_TYPES} block's `rich_text`, and
   * recurses into any block reporting `has_children` until {@link MAX_BLOCK_DEPTH}.
   * Text is newline-joined so chunking downstream sees paragraph boundaries.
   */
  private async collectBlockText(
    client: NotionClientLike,
    blockId: string,
    depth: number,
  ): Promise<string> {
    if (depth >= MAX_BLOCK_DEPTH) return "";

    const lines: string[] = [];
    let cursor: string | undefined;
    do {
      const response = await client.blocks.children.list({
        block_id: blockId,
        ...(cursor !== undefined ? { start_cursor: cursor } : {}),
      });

      for (const block of response.results) {
        const text = extractBlockText(block);
        if (text) lines.push(text);

        if (block.has_children) {
          const nested = await this.collectBlockText(
            client,
            block.id,
            depth + 1,
          );
          if (nested) lines.push(nested);
        }
      }

      cursor = response.has_more
        ? (response.next_cursor ?? undefined)
        : undefined;
    } while (cursor !== undefined);

    return lines.join("\n");
  }

}

/**
 * Extract a database row's title from its `title`-typed property.
 *
 * Notion exposes a row's title on whichever property has `type === "title"` (its
 * name varies, e.g. "Name"). This is the correct heading source — unlike a page's
 * child blocks, which only contain *sub-page* titles and would mis-attribute them.
 * Returns undefined when no non-empty title is present.
 */
function titleOf(page: NotionPage): string | undefined {
  for (const prop of Object.values(page.properties ?? {})) {
    if (prop.type === "title" && prop.title && prop.title.length > 0) {
      const text = prop.title
        .map((span) => span.plain_text)
        .join("")
        .trim();
      if (text.length > 0) return text;
    }
  }
  return undefined;
}

/**
 * Extract a block's plain text, or `""` when it is not a supported text block.
 *
 * Notion nests rich text under a key named after the block `type`, so we read
 * `block[block.type].rich_text` and concatenate each span's `plain_text`. Blocks
 * outside {@link TEXT_BLOCK_TYPES} (and any without `rich_text`) yield `""`.
 */
function extractBlockText(block: NotionBlock): string {
  if (!TEXT_BLOCK_TYPES.has(block.type)) return "";

  const data = block[block.type];
  if (typeof data !== "object" || data === null) return "";

  const richText = data.rich_text;
  if (richText === undefined) return "";

  return richText.map((span) => span.plain_text).join("");
}
