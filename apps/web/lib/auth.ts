/**
 * Authentication gate for the API routes.
 *
 * This is a deliberately thin placeholder: when AUTH_ENABLED is false (dev / public
 * widget) every request passes; when true it requires a Bearer token. Wiring the
 * actual verification to the configured AUTH_PROVIDER (Clerk / NextAuth / SAML) is
 * the one integration each deployment owns — see CONFIG.md#auth. Do NOT ship the
 * accept-any-token behaviour below to production unverified.
 */

import type { Env } from "@rag-chat-agent/rag-core";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  status?: number;
  message?: string;
}

export function authenticate(req: Request, env: Env): AuthResult {
  if (!env.AUTH_ENABLED) return { ok: true };

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Authentication required." };
  }
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) {
    return { ok: false, status: 401, message: "Invalid bearer token." };
  }

  // PLACEHOLDER: verify `token` with your AUTH_PROVIDER and derive the user id.
  // Until then we treat the token as an opaque user id.
  return { ok: true, userId: token };
}
