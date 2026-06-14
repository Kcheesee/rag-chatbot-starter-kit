import { afterEach, describe, expect, it } from "vitest";

import { loadEnv } from "@rag-chat-agent/rag-core";

import { authenticate } from "../auth";
import { clientIp } from "../http";
import { rateLimit, resetRateLimits } from "../rate-limit";

afterEach(() => resetRateLimits());

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
  it("passes through when AUTH is disabled", () => {
    const env = loadEnv({ AUTH_ENABLED: "false" });
    expect(authenticate(new Request("http://x/"), env)).toEqual({ ok: true });
  });

  it("requires a bearer token when AUTH is enabled", () => {
    const env = loadEnv({ AUTH_ENABLED: "true" });
    const denied = authenticate(new Request("http://x/"), env);
    expect(denied.ok).toBe(false);
    expect(denied.status).toBe(401);

    const ok = authenticate(
      new Request("http://x/", { headers: { authorization: "Bearer user-123" } }),
      env,
    );
    expect(ok).toMatchObject({ ok: true, userId: "user-123" });
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
