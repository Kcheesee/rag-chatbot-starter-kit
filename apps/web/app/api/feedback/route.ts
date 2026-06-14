/**
 * POST /api/feedback — thumbs up/down on an answer.
 *
 * Feedback is the highest-signal accuracy metric (every thumbs-down is a debugging
 * lead). This handler validates and records the event; here it emits a structured
 * log line — point it at your analytics/store, and capture the answer's retrieval
 * context alongside it so negative feedback is actionable.
 */

import { authenticate } from "@/lib/auth";
import { getEnv } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface FeedbackBody {
  sessionId: string;
  messageId: string;
  value: "up" | "down";
  namespace?: string;
}

function parseBody(body: unknown): FeedbackBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.sessionId !== "string" || typeof b.messageId !== "string") return null;
  if (b.value !== "up" && b.value !== "down") return null;
  return {
    sessionId: b.sessionId,
    messageId: b.messageId,
    value: b.value,
    ...(typeof b.namespace === "string" ? { namespace: b.namespace } : {}),
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
      { error: "Body must include sessionId, messageId, and value ('up' | 'down')." },
      { status: 400 },
    );
  }

  process.stdout.write(
    `${JSON.stringify({
      type: "feedback",
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
      ...body,
      ...(auth.userId ? { userId: auth.userId } : {}),
    })}\n`,
  );

  return Response.json({ ok: true });
}
