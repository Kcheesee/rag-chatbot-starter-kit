/**
 * pgvector adapter — Postgres + the `vector` extension as a vector store.
 *
 * Why a self-hosted Postgres option matters here: it keeps the knowledge base on
 * infrastructure the operator already controls, which is the path of least
 * resistance for air-gapped / federal deployments where a managed vector SaaS
 * (Pinecone, hosted Weaviate) is off the table. Embeddings, metadata, and grounding
 * hashes all live in one relational store that can be backed up and audited with the
 * rest of the application data.
 *
 * Design notes specific to pgvector, expanded on each member below:
 *  - One `pg.Pool` per connection string, memoised at module scope, so every adapter
 *    instance and every namespace-scoped view shares the same bounded set of
 *    connections instead of opening a socket per object.
 *  - Namespace isolation is a `namespace` *column* filtered in every statement,
 *    rather than a table-per-namespace. Tenants share the table (and its ANN index)
 *    but never see each other's rows.
 *  - Embeddings are serialised to pgvector's text format (`[1,2,3]`) and cast with
 *    `::vector` in SQL. All *values* are bound as parameters; only the table name is
 *    interpolated, and it is validated against a strict allow-list first.
 */

import type { Pool, PoolConfig, PoolClient } from "pg";

import type {
  EmbeddedChunk,
  MetadataFilter,
  SearchResult,
  StoredChunk,
  VectorAdapter,
} from "./types";
import {
  DEFAULT_NAMESPACE,
  DEFAULT_PREFIX,
  requireConfig,
  type VectorStoreConfig,
} from "./config";
import { toFlatMetadata, toSearchResult, toStoredChunk } from "./metadata";

/**
 * Module-level pool cache, keyed by connection string.
 *
 * Memoising here (not on the instance) is the whole point: `namespace()` hands back
 * a fresh `PgVectorAdapter`, and the factory may build several adapters against the
 * same database. Caching per object would multiply open connections; caching per
 * connection string means they all draw from one `Pool`. `pg.Pool` is internally
 * thread-safe for concurrent `query()` calls, so sharing is safe.
 */
const POOL_CACHE = new Map<string, Pool>();

/**
 * Tracks, per pool, the lazy "ensure schema" promise so the CREATE TABLE / CREATE
 * INDEX dance runs exactly once per process per pool even under concurrent first
 * calls (we await the same in-flight promise rather than racing a second DDL batch).
 */
const SCHEMA_READY = new WeakMap<Pool, Promise<void>>();

/** Postgres identifiers we generate must be a plain `[A-Za-z0-9_]` token. */
const SAFE_IDENTIFIER = /^[A-Za-z0-9_]+$/;

/**
 * Validate a config-supplied table name before it is interpolated into DDL/DML.
 *
 * The table name comes from trusted config rather than user input, but it is the one
 * piece of SQL we cannot bind as a `$n` parameter, so we still defend in depth:
 * reject anything that is not a bare identifier so a stray quote or space can never
 * become an injection vector.
 */
function assertSafeTable(table: string): string {
  if (!SAFE_IDENTIFIER.test(table)) {
    throw new Error(
      `PGVECTOR_TABLE "${table}" is not a valid Postgres identifier ` +
        `(allowed characters: letters, digits, underscore). See CONFIG.md#vector-store.`,
    );
  }
  return table;
}

/** Serialise an embedding to pgvector's text input format, e.g. `[0.1,0.2,0.3]`. */
function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}

/** Resolve the SSL posture into a `pg` `ssl` option (see class docs for policy). */
function resolveSsl(cfg: VectorStoreConfig): PoolConfig["ssl"] {
  // Undefined is treated as "prefer" — see the constructor's normalisation.
  switch (cfg.PGVECTOR_SSL) {
    case "require":
      // Mandatory verification: encrypt *and* validate the server certificate.
      return { rejectUnauthorized: true };
    case "disable":
      return false;
    case "prefer":
    default:
      // Encrypt opportunistically without failing on self-signed certs — the
      // common posture for an internal/dev Postgres. Federal mode forces "require"
      // upstream, so this branch is never reached there.
      return { rejectUnauthorized: false };
  }
}

/**
 * Build a stable connection-string key for the pool cache.
 *
 * Includes everything that distinguishes a physical connection (host/port/db/user/
 * ssl posture) so two configs that should share a pool hash to the same key and two
 * that must not (different SSL posture, different credentials) do not.
 */
function poolKey(cfg: VectorStoreConfig): string {
  const host = cfg.PGVECTOR_HOST ?? "";
  const port = cfg.PGVECTOR_PORT ?? 5432;
  const database = cfg.PGVECTOR_DATABASE ?? "";
  const user = cfg.PGVECTOR_USER ?? "";
  const ssl = cfg.PGVECTOR_SSL ?? "prefer";
  return `${user}@${host}:${port}/${database}?ssl=${ssl}`;
}

/**
 * Postgres + pgvector implementation of {@link VectorAdapter}.
 *
 * The constructor only validates config and normalises the SSL mode — it opens no
 * sockets. The pool is created lazily on first query via {@link getPool}, and the
 * schema is ensured once per pool via {@link ensureSchema}, so constructing an
 * adapter (including the throwaway instances `namespace()` creates) is cheap.
 */
export class PgVectorAdapter implements VectorAdapter {
  /** Validated, injection-safe table name shared across namespace views. */
  private readonly table: string;

  /**
   * @param cfg Vector store config; `PGVECTOR_HOST` is required for this adapter.
   * @param ns  Namespace this view is scoped to (stored verbatim in the `namespace`
   *            column). Defaults to {@link DEFAULT_NAMESPACE}.
   */
  constructor(
    private readonly cfg: VectorStoreConfig,
    private readonly ns: string = DEFAULT_NAMESPACE,
  ) {
    // Fail fast and loudly if the operator selected pgvector without a host.
    requireConfig(
      cfg.PGVECTOR_HOST,
      "PGVECTOR_HOST",
      "pgvector needs a Postgres host. Set PGVECTOR_HOST (and PORT/DATABASE/USER/" +
        "PASSWORD), or choose a different VECTOR_STORE.",
    );
    this.table = assertSafeTable(cfg.PGVECTOR_TABLE ?? DEFAULT_PREFIX);
    // An undefined SSL mode is treated as "prefer". We do not mutate `cfg` to record
    // that; both consumers — `resolveSsl` (pool construction) and `poolKey` (cache
    // key) — default undefined to "prefer" themselves, so the two views stay
    // consistent without side-effecting the caller's config object.
  }

  /**
   * Return a namespace-scoped view sharing this adapter's config (and therefore its
   * pool, since the pool is keyed off the connection string, not the instance).
   */
  namespace(ns: string): VectorAdapter {
    return new PgVectorAdapter(this.cfg, ns);
  }

  /**
   * Lazily obtain the shared pool for this connection string.
   *
   * Uses a dynamic `await import("pg")` so the (native-ish, heavy) driver is only
   * loaded when a pgvector adapter is actually used — matching how the other
   * provider adapters defer their SDK imports. `pg`'s CJS module exposes `Pool` as a
   * named export under ESM interop.
   */
  private async getPool(): Promise<Pool> {
    const key = poolKey(this.cfg);
    const existing = POOL_CACHE.get(key);
    if (existing) return existing;

    const { Pool: PgPool } = await import("pg");
    const pool = new PgPool({
      host: this.cfg.PGVECTOR_HOST,
      port: this.cfg.PGVECTOR_PORT ?? 5432,
      database: this.cfg.PGVECTOR_DATABASE,
      user: this.cfg.PGVECTOR_USER,
      password: this.cfg.PGVECTOR_PASSWORD,
      ssl: resolveSsl(this.cfg),
    });

    // Guard against a double-construct race: if another caller populated the cache
    // while we awaited the import, drop ours and reuse theirs.
    const raced = POOL_CACHE.get(key);
    if (raced) {
      await pool.end();
      return raced;
    }
    POOL_CACHE.set(key, pool);
    return pool;
  }

  /**
   * Ensure the extension, table, and namespace index exist — once per pool.
   *
   * Idempotent (`IF NOT EXISTS` throughout) and memoised on the pool so concurrent
   * first calls await a single DDL batch instead of racing duplicate CREATEs. The
   * `embedding` column is an *unbounded* `vector` so this boilerplate stays
   * provider-agnostic across embedding models of different dimensionality.
   *
   * NOTE for production: an unbounded `vector` column cannot carry an ANN index. Once
   * your embedding dimension is fixed, ALTER the column to `vector(<dim>)` and add an
   * `ivfflat` or `hnsw` index on `embedding vector_cosine_ops` sized to that
   * dimension — otherwise every search is a sequential scan.
   */
  private async ensureSchema(pool: Pool): Promise<void> {
    const ready = SCHEMA_READY.get(pool);
    if (ready) return ready;

    const table = this.table; // already validated as a safe identifier
    const run = (async (): Promise<void> => {
      const client: PoolClient = await pool.connect();
      try {
        await client.query("CREATE EXTENSION IF NOT EXISTS vector;");
        await client.query(
          `CREATE TABLE IF NOT EXISTS ${table} (
             id text PRIMARY KEY,
             namespace text NOT NULL,
             content text NOT NULL,
             embedding vector,
             metadata jsonb NOT NULL,
             content_hash text NOT NULL
           );`,
        );
        await client.query(
          `CREATE INDEX IF NOT EXISTS ${table}_namespace_idx ON ${table} (namespace);`,
        );
      } finally {
        client.release();
      }
    })();

    // Cache the in-flight promise immediately so concurrent callers share it; on
    // failure, clear it so a later call can retry rather than caching a rejection.
    SCHEMA_READY.set(pool, run);
    try {
      await run;
    } catch (err) {
      SCHEMA_READY.delete(pool);
      throw err;
    }
    return run;
  }

  /** Get a schema-ready pool: resolves the pool and ensures DDL has run. */
  private async ready(): Promise<Pool> {
    const pool = await this.getPool();
    await this.ensureSchema(pool);
    return pool;
  }

  /**
   * Top-K cosine search within this namespace, optionally narrowed by metadata.
   *
   * `<=>` is pgvector's cosine *distance* operator; cosine *similarity* (the [0,1]
   * score our contract promises) is `1 - distance`. We ORDER BY the same distance so
   * the planner can use an ANN index once one exists. The optional `filter` becomes a
   * JSONB containment (`metadata @> $jsonb`) over scalar keys only — array-valued
   * filters are skipped here to keep the boilerplate simple and the query planner
   * happy; richer filtering is a per-deployment concern.
   */
  async search(
    embedding: number[],
    topK: number,
    filter?: MetadataFilter,
  ): Promise<SearchResult[]> {
    const pool = await this.ready();
    const vectorLiteral = toVectorLiteral(embedding);

    const params: Array<string | number> = [vectorLiteral, this.ns];
    let where = "namespace = $2";

    const containment = scalarContainment(filter);
    if (containment !== null) {
      params.push(containment);
      where += ` AND metadata @> $${params.length}::jsonb`;
    }

    params.push(topK);
    const limitIdx = params.length;

    const sql =
      `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) AS score ` +
      `FROM ${this.table} ` +
      `WHERE ${where} ` +
      `ORDER BY embedding <=> $1::vector ` +
      `LIMIT $${limitIdx};`;

    const res = await pool.query<VectorRow & { score: number | string }>(sql, params);
    // jsonb comes back already parsed into a JS object, so metadata needs no JSON.parse.
    // Cosine distance is [0, 2]; clamp 1 - distance into the [0, 1] similarity our
    // contract promises (near-opposite vectors would otherwise score below 0).
    return res.rows.map((row) =>
      toSearchResult(row.id, row.content, row.metadata, Math.max(0, Math.min(1, Number(row.score)))),
    );
  }

  /**
   * Insert or update chunks, idempotent on `id`.
   *
   * Re-ingesting the same source overwrites the row (content, embedding, metadata,
   * and hash) via `ON CONFLICT (id) DO UPDATE`, which keeps the grounding hash in
   * sync with the latest text. All rows are written in a single transaction so a
   * partial batch never leaves the store half-updated. Each chunk is bound as
   * parameters — nothing about the chunk is interpolated into SQL.
   */
  async upsert(chunks: EmbeddedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const pool = await this.ready();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const sql =
        `INSERT INTO ${this.table} (id, namespace, content, embedding, metadata, content_hash) ` +
        `VALUES ($1, $2, $3, $4::vector, $5::jsonb, $6) ` +
        `ON CONFLICT (id) DO UPDATE SET ` +
        `namespace = EXCLUDED.namespace, ` +
        `content = EXCLUDED.content, ` +
        `embedding = EXCLUDED.embedding, ` +
        `metadata = EXCLUDED.metadata, ` +
        `content_hash = EXCLUDED.content_hash;`;
      for (const chunk of chunks) {
        await client.query(sql, [
          chunk.id,
          this.ns,
          chunk.text,
          toVectorLiteral(chunk.embedding),
          JSON.stringify(toFlatMetadata(chunk.metadata)),
          chunk.contentHash,
        ]);
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete chunks by id within this namespace.
   *
   * The `namespace = $2` clause is a safety belt: a tenant can only delete its own
   * rows even if an id collides across namespaces. `ANY($1::text[])` deletes the
   * whole batch in one round-trip.
   */
  async delete(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const pool = await this.ready();
    await pool.query(
      `DELETE FROM ${this.table} WHERE id = ANY($1::text[]) AND namespace = $2;`,
      [ids, this.ns],
    );
  }

  /**
   * Delete every chunk in this namespace that came from `sourceFile`. Called before
   * re-ingesting a source so stale chunks (e.g. trailing chunks of a now-shorter doc)
   * don't linger and get retrieved. Idempotent: deleting an absent source is a no-op.
   *
   * `sourceFile` lives inside the `metadata` jsonb under the flattened top-level key
   * `sourceFile`, so we match on `metadata->>'sourceFile'` (the `->>` operator returns
   * the value as text, which compares cleanly to the bound string). The
   * `namespace = $1` clause is the same tenant safety belt as {@link delete}: a source
   * path can recur across namespaces, and a tenant must only ever clear its own rows.
   * Both values are bound as parameters; only the validated table name is interpolated.
   */
  async deleteBySource(sourceFile: string): Promise<void> {
    const pool = await this.ready();
    await pool.query(
      `DELETE FROM ${this.table} WHERE namespace = $1 AND metadata->>'sourceFile' = $2;`,
      [this.ns, sourceFile],
    );
  }

  /**
   * Fetch a single chunk by id within this namespace, or null if absent.
   *
   * Mandatory for the response cache's grounding check, which re-reads the chunk a
   * cached answer cited and compares `contentHash` to detect that the source changed.
   */
  async getById(id: string): Promise<StoredChunk | null> {
    const pool = await this.ready();
    const res = await pool.query<VectorRow>(
      `SELECT id, content, metadata FROM ${this.table} WHERE id = $1 AND namespace = $2;`,
      [id, this.ns],
    );
    const row = res.rows[0];
    if (!row) return null;
    return toStoredChunk(row.id, row.content, row.metadata);
  }
}

/** Row shape selected by reads: jsonb `metadata` arrives as a parsed object. */
interface VectorRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

/**
 * Reduce a {@link MetadataFilter} to a JSON string suitable for `metadata @> $::jsonb`
 * containment, keeping only scalar (string/number/boolean) keys.
 *
 * Returns the JSON string, or `null` when there is nothing to filter on — so the
 * caller can skip the clause entirely. Array-valued and undefined entries are
 * dropped on purpose (see {@link PgVectorAdapter.search}).
 */
function scalarContainment(filter?: MetadataFilter): string | null {
  if (!filter) return null;
  const scalar: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || Array.isArray(value)) continue;
    scalar[key] = value;
  }
  if (Object.keys(scalar).length === 0) return null;
  return JSON.stringify(scalar);
}
