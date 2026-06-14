/**
 * GET /api/health — liveness + readiness.
 *
 * Reports per-dependency status. The LLM check is config-presence only (we don't
 * burn a token per probe). The vector store gets a real reachability check for the
 * HTTP-reachable stores (Chroma, Weaviate) and a construct-check for the rest. The
 * cache/session check actually pings Redis when SESSION_STORE=redis, over a single
 * memoised probe connection (so a load balancer hammering /health can't leak sockets).
 */

import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";
import { createRedisClient } from "@rag-chat-agent/rag-core";

import { fetchWithTimeout } from "@/lib/http";
import { getEnv } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

type Status = "ok" | "error";

// One reused probe connection, created lazily on the first Redis health check.
let healthRedis: ReturnType<typeof createRedisClient> | null = null;

async function checkRedis(env: ReturnType<typeof getEnv>): Promise<Status> {
  if (env.SESSION_STORE !== "redis") return "ok"; // in-memory is always available
  try {
    if (!healthRedis) healthRedis = createRedisClient(env);
    const pong = await Promise.race([
      healthRedis.ping(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("redis ping timeout")), 1500),
      ),
    ]);
    return pong === "PONG" ? "ok" : "error";
  } catch {
    return "error";
  }
}

function checkLLM(env: ReturnType<typeof getEnv>): Status {
  switch (env.LLM_PROVIDER) {
    case "anthropic":
      return env.ANTHROPIC_API_KEY ? "ok" : "error";
    case "openai":
      return env.OPENAI_API_KEY ? "ok" : "error";
    case "bedrock":
    case "bedrock-gov":
      return env.AWS_REGION && env.AWS_BEDROCK_MODEL ? "ok" : "error";
    case "vertex":
      return env.VERTEX_PROJECT && env.VERTEX_MODEL ? "ok" : "error";
    case "azure-openai":
    case "azure-gov":
      return env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT ? "ok" : "error";
    case "internal":
      return env.INTERNAL_LLM_ENDPOINT && env.INTERNAL_LLM_MODEL ? "ok" : "error";
    default:
      return "error";
  }
}

async function checkVectorStore(env: ReturnType<typeof getEnv>): Promise<Status> {
  try {
    createVectorAdapter(env); // throws on missing required config
    if (env.VECTOR_STORE === "chroma") {
      const url = env.CHROMA_URL ?? "http://localhost:8000";
      const res = await fetchWithTimeout(`${url.replace(/\/$/, "")}/api/v1/heartbeat`, 1500);
      return res.ok ? "ok" : "error";
    }
    if (env.VECTOR_STORE === "weaviate" && env.WEAVIATE_URL) {
      const url = env.WEAVIATE_URL.replace(/\/$/, "");
      const res = await fetchWithTimeout(`${url}/v1/.well-known/ready`, 1500);
      return res.ok ? "ok" : "error";
    }
    // pgvector / pinecone: construct-check only (no cheap unauthenticated ping).
    return "ok";
  } catch {
    return "error";
  }
}

export async function GET(): Promise<Response> {
  const env = getEnv();
  const [llm, vectorStore, cache] = await Promise.all([
    Promise.resolve(checkLLM(env)),
    checkVectorStore(env),
    checkRedis(env), // verifies Redis when SESSION_STORE=redis; "ok" for in-memory
  ]);

  const allOk = llm === "ok" && vectorStore === "ok" && cache === "ok";
  const status = allOk ? "ok" : vectorStore === "error" ? "down" : "degraded";

  return Response.json(
    {
      status,
      llm,
      vectorStore,
      cache,
      version: env.APP_VERSION,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    },
    { status: status === "down" ? 503 : 200 },
  );
}
