import { afterEach, describe, expect, it } from "vitest";

import { loadEnv } from "@rag-chat-agent/rag-core";

import {
  authenticate,
  authorizeNamespace,
  clearTokenVerifier,
  requireAdmin,
  setTokenVerifier,
} from "../auth";
import { clientIp } from "../http";
import { rateLimit, resetRateLimits } from "../rate-limit";

afterEach(() => {
  resetRateLimits();
  clearTokenVerifier();
});

const bearer = (token: string): Request =>
  new Request("http://x/", { headers: { authorization: `Bearer ${token}` } });

describe("rateLimit", () => {
  it("allows up to the limit then blocks", () => {
    expect(rateLimit("k", 2)).toBe(true);
    expect(rateLimit("k", 2)).toBe(true);
    expect(rateLimit("k", 2)).toBe(false);
  });

  it("keys are independent", () => {
    expect(rateLimit("a", 1)).toBe(true);
    expect(rateLimit("a", 1)).toBe(false);
    expect(rateLimit("b", 1)).toBe(true);
  });
});

describe("authenticate", () => {
  it("passes through as an unrestricted admin when AUTH is disabled", async () => {
    const env = loadEnv({ AUTH_ENABLED: "false" });
    const result = await authenticate(new Request("http://x/"), env);
    expect(result).toMatchObject({ ok: true, isAdmin: true, namespaceAccess: "any" });
  });

  it("requires a bearer token when AUTH is enabled", async () => {
    const env = loadEnv({ AUTH_ENABLED: "true", AUTH_ALLOW_INSECURE_TOKENS: "true" });
    const denied = await authenticate(new Request("http://x/"), env);
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(401);
  });

  it("FAILS CLOSED when AUTH is enabled but no verifier is configured", async () => {
    const env = loadEnv({ AUTH_ENABLED: "true" });
    const result = await authenticate(bearer("anything"), env);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
  });

  it("accepts any token only when insecure tokens are explicitly enabled (dev)", async () => {
    const env = loadEnv({ AUTH_ENABLED: "true", AUTH_ALLOW_INSECURE_TOKENS: "true" });
    const result = await authenticate(bearer("user-123"), env);
    expect(result).toMatchObject({ ok: true, userId: "user-123", isAdmin: false, namespaceAccess: "any" });
  });

  it("verifies against AUTH_STATIC_TOKENS, granting tenant + admin scope", async () => {
    const env = loadEnv({
      AUTH_ENABLED: "true",
      AUTH_STATIC_TOKENS: JSON.stringify([
        { token: "sek-admin", userId: "ops", admin: true, namespaces: ["acme"] },
      ]),
    });
    const ok = await authenticate(bearer("sek-admin"), env);
    expect(ok).toMatchObject({ ok: true, userId: "ops", isAdmin: true, namespaceAccess: ["acme"] });

    const bad = await authenticate(bearer("not-a-token"), env);
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(401);
  });

  it("uses a registered custom verifier when present", async () => {
    setTokenVerifier((token) => (token === "good" ? { userId: "u", namespaceAccess: "any" } : null));
    const env = loadEnv({ AUTH_ENABLED: "true" });
    expect(await authenticate(bearer("good"), env)).toMatchObject({ ok: true, userId: "u" });
    expect((await authenticate(bearer("bad"), env)).status).toBe(401);
  });
});

describe("authorizeNamespace", () => {
  it("'any' access allows everything", () => {
    expect(authorizeNamespace({ ok: true, namespaceAccess: "any" }, "whatever")).toBe(true);
  });

  it("a scoped list permits only its members", () => {
    const auth = { ok: true, namespaceAccess: ["acme", "globex"] as const };
    expect(authorizeNamespace(auth, "acme")).toBe(true);
    expect(authorizeNamespace(auth, "initech")).toBe(false);
  });
});

describe("requireAdmin", () => {
  it("is true only for admin identities", () => {
    expect(requireAdmin({ ok: true, isAdmin: true })).toBe(true);
    expect(requireAdmin({ ok: true, isAdmin: false })).toBe(false);
    expect(requireAdmin({ ok: true })).toBe(false);
  });
});

describe("clientIp", () => {
  it("reads the first x-forwarded-for entry", () => {
    const req = new Request("http://x/", { headers: { "x-forwarded-for": "1.2.3.4, 5.6.7.8" } });
    expect(clientIp(req)).toBe("1.2.3.4");
  });

  it("falls back to 'unknown'", () => {
    expect(clientIp(new Request("http://x/"))).toBe("unknown");
  });
});
