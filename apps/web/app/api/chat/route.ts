/**
 * POST /api/chat — streaming chat endpoint.
 *
 * Order matches the spec: auth first, rate-limit second, validate body, then stream
 * the pipeline. The response is newline-delimited JSON of `StreamChunk`s
 * (token / sources / done / error) — simple to parse on the client and proxy-safe.
 */

import { authenticate } from "@/lib/auth";
import { clientIp } from "@/lib/http";
import { rateLimit } from "@/lib/rate-limit";
import { getEnv, getPipeline } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  query: string;
  sessionId: string;
  namespace: string;
}

function parseBody(body: unknown): ChatBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.query !== "string" || typeof b.sessionId !== "string" || typeof b.namespace !== "string") {
    return null;
  }
  if (b.query.trim().length === 0) return null;
  return { query: b.query, sessionId: b.sessionId, namespace: b.namespace };
}

export async function POST(req: Request): Promise<Response> {
  const env = getEnv();

  const auth = authenticate(req, env);
  if (!auth.ok) {
    return Response.json({ error: auth.message }, { status: auth.status ?? 401 });
  }

  const rateKey = auth.userId ?? clientIp(req);
  if (!rateLimit(`chat:${rateKey}`, env.AUTH_RATE_LIMIT)) {
    return Response.json({ error: "Rate limit exceeded. Try again shortly." }, { status: 429 });
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
      { error: "Body must include a non-empty query, a sessionId, and a namespace." },
      { status: 400 },
    );
  }

  const pipeline = getPipeline();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of pipeline.stream({
          query: body.query,
          sessionId: body.sessionId,
          namespace: body.namespace,
          ...(auth.userId ? { userId: auth.userId } : {}),
          signal: req.signal,
        })) {
          controller.enqueue(encoder.encode(`${JSON.stringify(chunk)}\n`));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", error: message })}\n`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
