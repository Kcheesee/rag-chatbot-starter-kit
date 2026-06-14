/**
 * GET /api/health — liveness + readiness.
 *
 * Reports per-dependency status. The LLM check is config-presence only (we don't
 * burn a token per probe); the vector store gets a real reachability check for
 * Chroma (the local dev default) and a construct-check for the managed stores.
 */

import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";

import { fetchWithTimeout } from "@/lib/http";
import { getEnv } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const startedAt = Date.now();

type Status = "ok" | "error";

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
    return "ok";
  } catch {
    return "error";
  }
}

export async function GET(): Promise<Response> {
  const env = getEnv();
  const llm = checkLLM(env);
  const vectorStore = await checkVectorStore(env);
  const cache: Status = "ok"; // in-memory is always available; Redis errors surface on use

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
