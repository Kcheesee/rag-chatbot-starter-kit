import { afterEach, describe, expect, it, vi } from "vitest";

import { loadEnv, type Env } from "@rag-chat-agent/rag-core";

/**
 * GET /api/health probes the LLM (config presence), vector store (construct + optional
 * HTTP heartbeat) and Redis cache. We mock every outbound seam so NO network happens:
 *
 *  - `@/lib/pipeline`.getEnv  → a controlled, fully-typed Env (built via loadEnv).
 *  - `@rag-chat-agent/vector-adapters`.createVectorAdapter → no-op (or throws when we
 *     want the vector store to read "error").
 *  - `@rag-chat-agent/rag-core`.createRedisClient → a fake `{ ping }` (only used when
 *     SESSION_STORE=redis).
 *  - global fetch → a stub for the Chroma/Weaviate heartbeat.
 *
 * The route source is NOT modified.
 */

const getEnvMock = vi.fn<() => Env>();
const createVectorAdapterMock = vi.fn();
const pingMock = vi.fn<() => Promise<string>>();

vi.mock("@/lib/pipeline", () => ({
  getEnv: () => getEnvMock(),
}));

vi.mock("@rag-chat-agent/vector-adapters", () => ({
  createVectorAdapter: (...args: unknown[]) => createVectorAdapterMock(...args),
}));

// Only createRedisClient is consumed by the route; keep the real rest of rag-core
// (loadEnv etc.) so we can still build a valid Env for the mocked getEnv.
vi.mock("@rag-chat-agent/rag-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@rag-chat-agent/rag-core")>();
  return {
    ...actual,
    createRedisClient: () => ({ ping: pingMock }),
  };
});

import { GET } from "../route";

/** A fully-valid Env with the given overrides (no caching, no process.env read). */
function env(overrides: Record<string, string> = {}): Env {
  return loadEnv({ LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", ...overrides });
}

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  createVectorAdapterMock.mockReset();
  pingMock.mockReset();
});

describe("GET /api/health", () => {
  it("reports status 'ok' with 200 when every dependency is healthy", async () => {
    // Default vector store is chroma → the route hits a heartbeat URL; stub it ok.
    getEnvMock.mockReturnValue(env());
    createVectorAdapterMock.mockReturnValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const res = await GET();
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      status: "ok",
      llm: "ok",
      vectorStore: "ok",
      cache: "ok",
      version: "0.1.0",
    });
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime as number).toBeGreaterThanOrEqual(0);
  });

  it("reports status 'down' with 503 when the vector store is unreachable", async () => {
    getEnvMock.mockReturnValue(env());
    createVectorAdapterMock.mockReturnValue({});
    // Chroma heartbeat returns not-ok → vectorStore "error" → overall "down".
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

    const res = await GET();
    expect(res.status).toBe(503);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("down");
    expect(body.vectorStore).toBe("error");
    expect(body.llm).toBe("ok");
  });

  it("reports 'down' when constructing the vector adapter throws (missing config)", async () => {
    getEnvMock.mockReturnValue(env());
    createVectorAdapterMock.mockImplementation(() => {
      throw new Error("missing required vector store config");
    });
    // fetch must never be reached on the throw path.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).vectorStore).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps a non-chroma/weaviate store to a construct-only 'ok' with no heartbeat fetch", async () => {
    getEnvMock.mockReturnValue(env({ VECTOR_STORE: "pgvector", DATABASE_URL: "postgres://x/db" }));
    createVectorAdapterMock.mockReturnValue({});
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.vectorStore).toBe("ok");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports 'degraded' (200) when only the Redis cache check fails", async () => {
    getEnvMock.mockReturnValue(env({ SESSION_STORE: "redis", REDIS_URL: "redis://localhost:6379" }));
    createVectorAdapterMock.mockReturnValue({});
    // Vector store (chroma) ok, but Redis ping returns the wrong reply → cache "error".
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    pingMock.mockResolvedValue("NOPE");

    const res = await GET();
    expect(res.status).toBe(200); // degraded, not down (vector store still ok)
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("degraded");
    expect(body.cache).toBe("error");
    expect(body.vectorStore).toBe("ok");
  });

  it("pings Redis and reads 'ok' on a PONG when SESSION_STORE=redis", async () => {
    getEnvMock.mockReturnValue(env({ SESSION_STORE: "redis", REDIS_URL: "redis://localhost:6379" }));
    createVectorAdapterMock.mockReturnValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    pingMock.mockResolvedValue("PONG");

    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
    expect(pingMock).toHaveBeenCalled();
  });

  it("reports llm 'error' (degraded) when the configured provider key is absent", async () => {
    // openai provider but no OPENAI_API_KEY → checkLLM "error"; vector store stays ok.
    getEnvMock.mockReturnValue(loadEnv({ LLM_PROVIDER: "openai" }));
    createVectorAdapterMock.mockReturnValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));

    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.llm).toBe("error");
    expect(body.status).toBe("degraded");
  });
});
