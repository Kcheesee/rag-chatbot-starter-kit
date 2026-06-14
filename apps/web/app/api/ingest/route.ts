/**
 * POST /api/ingest — document ingestion (admin-gated).
 *
 * Ingest is a privileged operation: someone who can add documents can poison the
 * knowledge base. It's gated behind `authenticate` (so it's protected whenever AUTH
 * is enabled). With AUTH disabled it's open for local dev — protect it before going
 * to production (enable AUTH, or front it with your platform's admin auth).
 */

import { authenticate } from "@/lib/auth";
import { getEnv } from "@/lib/pipeline";
import { runIngest, type IngestRequest } from "@/lib/ingest";
import type { LoaderSourceType } from "@rag-chat-agent/ingestion";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: readonly LoaderSourceType[] = [
  "pdf",
  "md",
  "docx",
  "txt",
  "url",
  "sitemap",
] as const;

function parseBody(body: unknown): IngestRequest | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.source !== "string" || typeof b.namespace !== "string") return null;
  if (!Array.isArray(b.types)) return null;
  const types = b.types.filter((t): t is LoaderSourceType =>
    (VALID_TYPES as readonly string[]).includes(t as string),
  );
  if (types.length === 0) return null;
  return {
    source: b.source,
    types,
    namespace: b.namespace,
    ...(typeof b.dryRun === "boolean" ? { dryRun: b.dryRun } : {}),
  };
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();
  const auth = authenticate(req, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status ?? 401 });
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const body = parseBody(raw);
  if (!body) {
    return Response.json(
      {
        error:
          "Body must include source (string), namespace (string), and types " +
          `(array of: ${VALID_TYPES.join(", ")}).`,
      },
      { status: 400 },
    );
  }

  try {
    const result = await runIngest(body);
    return Response.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: `Ingest failed: ${message}` }, { status: 500 });
  }
}
