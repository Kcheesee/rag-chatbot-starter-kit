/**
 * Authentication & tenant authorization for the API routes.
 *
 * Design goals for a boilerplate that must be safe to deploy as-is:
 *   1. FAIL CLOSED. When AUTH_ENABLED is true but no token verifier is configured,
 *      every request is rejected — the old "any non-empty bearer token is a valid
 *      user" behaviour is gone. You opt back into it explicitly, for dev only, with
 *      AUTH_ALLOW_INSECURE_TOKENS=true.
 *   2. PLUGGABLE. Real deployments register a verifier (Clerk / NextAuth / a JWKS
 *      validator / SAML assertion) via `setTokenVerifier` — typically in
 *      instrumentation.ts. A built-in static-token verifier (AUTH_STATIC_TOKENS)
 *      covers simple and test deployments without extra code.
 *   3. TENANT-SCOPED. A verified identity carries which namespace(s) it may touch.
 *      Routes call `authorizeNamespace` so a caller can never read another tenant's
 *      data by passing an arbitrary namespace in the request body.
 *   4. ADMIN-GATED writes. Ingestion is privileged; routes call `requireAdmin`.
 *
 * See CONFIG.md#auth for wiring instructions.
 */

import type { Env } from "@rag-chat-agent/rag-core";

/** A caller proven to be who they claim, produced by a {@link TokenVerifier}. */
export interface VerifiedIdentity {
  /** Stable user/principal id (used for rate-limit keys and audit). */
  userId: string;
  /** May this principal perform privileged operations (e.g. ingestion)? */
  isAdmin?: boolean;
  /**
   * Which namespaces this principal may access. `"any"` lifts the restriction
   * (single-tenant / trusted deployments); an explicit list pins multi-tenant
   * isolation. Omitted → the deployment's AUTH_DEFAULT_NAMESPACE.
   */
  namespaceAccess?: "any" | readonly string[];
}

/**
 * Verifies a bearer token and returns the identity, or `null` to reject it.
 * Async so JWKS/IdP round-trips fit. Register yours with {@link setTokenVerifier}.
 */
export type TokenVerifier = (token: string) => VerifiedIdentity | null | Promise<VerifiedIdentity | null>;

let customVerifier: TokenVerifier | null = null;

/** Register the deployment's token verifier (call once at startup). */
export function setTokenVerifier(verifier: TokenVerifier): void {
  customVerifier = verifier;
}

/** Remove the registered verifier. Primarily for tests. */
export function clearTokenVerifier(): void {
  customVerifier = null;
}

export interface AuthResult {
  ok: boolean;
  userId?: string;
  isAdmin?: boolean;
  /** Resolved namespace authority for this request. */
  namespaceAccess?: "any" | readonly string[];
  status?: number;
  message?: string;
}

/** Shape of a single entry in the AUTH_STATIC_TOKENS JSON array. */
interface StaticTokenEntry {
  token: string;
  userId?: string;
  admin?: boolean;
  namespaces?: string[];
}

// Memoise the parsed static-token table keyed by the raw env string, so we parse
// once per process but still pick up a changed value in tests.
let staticCacheKey: string | undefined;
let staticCacheValue: Map<string, VerifiedIdentity> | null = null;

/**
 * Parse AUTH_STATIC_TOKENS into a token→identity map. Throws on malformed JSON so a
 * misconfiguration fails loudly rather than silently disabling auth.
 */
function parseStaticTokens(raw: string | undefined): Map<string, VerifiedIdentity> | null {
  if (!raw || raw.trim().length === 0) return null;
  if (raw === staticCacheKey) return staticCacheValue;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("AUTH_STATIC_TOKENS is not valid JSON. See CONFIG.md#auth.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("AUTH_STATIC_TOKENS must be a JSON array of identities. See CONFIG.md#auth.");
  }

  const map = new Map<string, VerifiedIdentity>();
  for (const item of parsed) {
    const entry = item as StaticTokenEntry;
    if (typeof entry?.token !== "string" || entry.token.length === 0) {
      throw new Error("Each AUTH_STATIC_TOKENS entry needs a non-empty 'token'. See CONFIG.md#auth.");
    }
    const identity: VerifiedIdentity = {
      userId: entry.userId ?? entry.token,
      isAdmin: entry.admin === true,
      ...(Array.isArray(entry.namespaces) ? { namespaceAccess: entry.namespaces } : {}),
    };
    map.set(entry.token, identity);
  }

  staticCacheKey = raw;
  staticCacheValue = map;
  return map;
}

/** Turn a verified identity into an AuthResult, applying the default namespace. */
function grant(id: VerifiedIdentity, env: Env): AuthResult {
  return {
    ok: true,
    userId: id.userId,
    isAdmin: id.isAdmin === true,
    namespaceAccess: id.namespaceAccess ?? [env.AUTH_DEFAULT_NAMESPACE],
  };
}

const UNAUTHORIZED: AuthResult = { ok: false, status: 401, message: "Authentication required." };

/**
 * Authenticate a request. Resolution order:
 *   1. AUTH disabled → pass as an unrestricted local admin (dev / public widget).
 *   2. No bearer token → 401.
 *   3. A registered custom verifier (Clerk/JWKS/SAML) decides.
 *   4. Else AUTH_STATIC_TOKENS, if configured.
 *   5. Else AUTH_ALLOW_INSECURE_TOKENS → opaque user id (DEV ONLY, no tenant scope).
 *   6. Else FAIL CLOSED (503): auth is on but nothing can verify a token.
 */
export async function authenticate(req: Request, env: Env): Promise<AuthResult> {
  if (!env.AUTH_ENABLED) {
    // Local/dev or public-widget mode: open, and treated as admin so `npm run dev`
    // can ingest. Protect this before production by enabling AUTH.
    return { ok: true, isAdmin: true, namespaceAccess: "any" };
  }

  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return UNAUTHORIZED;
  const token = header.slice("Bearer ".length).trim();
  if (token.length === 0) return { ok: false, status: 401, message: "Invalid bearer token." };

  if (customVerifier) {
    const id = await customVerifier(token);
    return id ? grant(id, env) : UNAUTHORIZED;
  }

  let staticMap: Map<string, VerifiedIdentity> | null;
  try {
    staticMap = parseStaticTokens(env.AUTH_STATIC_TOKENS);
  } catch (err) {
    const message = err instanceof Error ? err.message : "AUTH_STATIC_TOKENS is misconfigured.";
    return { ok: false, status: 500, message };
  }
  if (staticMap) {
    const id = staticMap.get(token);
    return id ? grant(id, env) : UNAUTHORIZED;
  }

  if (env.AUTH_ALLOW_INSECURE_TOKENS) {
    // EXPLICIT, DEV-ONLY fallback: trust the token as an opaque id, no tenant scope.
    return { ok: true, userId: token, isAdmin: false, namespaceAccess: "any" };
  }

  // Fail closed: auth is enabled but nothing can verify the token.
  return {
    ok: false,
    status: 503,
    message:
      "Authentication is enabled but no token verifier is configured. Register a verifier " +
      "(setTokenVerifier), set AUTH_STATIC_TOKENS, or — for local dev only — set " +
      "AUTH_ALLOW_INSECURE_TOKENS=true. See CONFIG.md#auth.",
  };
}

/**
 * Is `requested` a namespace this caller may use? Prevents a client from reading
 * another tenant's data by passing an arbitrary namespace. Admin status does NOT
 * widen namespace access — grant `"any"` or list the namespaces explicitly.
 */
export function authorizeNamespace(auth: AuthResult, requested: string): boolean {
  if (auth.namespaceAccess === "any") return true;
  const access = auth.namespaceAccess;
  return Array.isArray(access) && access.includes(requested);
}

/** Does this caller hold admin rights (required for ingestion)? */
export function requireAdmin(auth: AuthResult): boolean {
  return auth.isAdmin === true;
}
