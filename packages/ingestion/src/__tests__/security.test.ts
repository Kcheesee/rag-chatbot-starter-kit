/**
 * Tests for the loader-hardening guards.
 *
 * WHY no real network/DNS: every check that would otherwise resolve a name or open a
 * socket is fed through the injected seams — `assertUrlAllowed`'s `lookup` parameter and
 * `guardedFetch`'s `deps.{fetchImpl,lookup}`. That keeps the suite deterministic and
 * offline. Path tests use a real temp dir because `assertPathAllowed`'s whole job is real
 * `realpathSync`/symlink resolution, which cannot be meaningfully mocked.
 */

import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertUrlAllowed,
  assertPathAllowed,
  guardedFetch,
  type DnsLookup,
} from "../loaders/security";

/** A DNS seam that always resolves to one public address (203.0.113.10, TEST-NET-3). */
const publicLookup: DnsLookup = async () => [{ address: "203.0.113.10", family: 4 }];

/** A DNS seam that maps any name to an internal address — the rebinding attack. */
const internalLookup: DnsLookup = async () => [{ address: "127.0.0.1", family: 4 }];

describe("assertUrlAllowed — scheme gate", () => {
  for (const bad of [
    "ftp://example.com/x",
    "file:///etc/passwd",
    "gopher://example.com/",
    "data:text/plain,hi",
  ]) {
    it(`rejects non-http(s) scheme: ${bad}`, async () => {
      await expect(assertUrlAllowed(bad, {}, publicLookup)).rejects.toThrow(
        /only http\/https are allowed/,
      );
    });
  }

  it("accepts a public http(s) host", async () => {
    const url = await assertUrlAllowed("https://example.com/docs", {}, publicLookup);
    expect(url.hostname).toBe("example.com");
  });
});

describe("assertUrlAllowed — private/loopback/link-local/metadata IPv4 literals", () => {
  for (const host of [
    "10.0.0.1",
    "172.16.5.5",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "169.254.1.1",
    "169.254.169.254", // cloud metadata
    "0.0.0.0",
    "100.64.0.1", // CGNAT
  ]) {
    it(`rejects blocked IPv4 literal ${host}`, async () => {
      await expect(assertUrlAllowed(`http://${host}/`, {}, publicLookup)).rejects.toThrow(
        /private, loopback, link-local, or metadata/,
      );
    });
  }

  it("accepts a public IPv4 literal", async () => {
    const url = await assertUrlAllowed("http://203.0.113.10/", {}, publicLookup);
    expect(url.hostname).toBe("203.0.113.10");
  });

  it("rejects a public name whose DNS resolves to an internal IP (rebinding)", async () => {
    await expect(
      assertUrlAllowed("https://evil.example.com/", {}, internalLookup),
    ).rejects.toThrow(/resolves to a private/);
  });
});

describe("assertUrlAllowed — IPv6 + IPv4-mapped literals", () => {
  for (const host of [
    "[::1]", // loopback
    "[fc00::1]", // unique-local
    "[fd12:3456::1]", // unique-local
    "[fe80::1]", // link-local
    "[::ffff:127.0.0.1]", // IPv4-mapped loopback
    "[::ffff:169.254.169.254]", // IPv4-mapped metadata
    "[::ffff:7f00:0001]", // hex-encoded IPv4-mapped 127.0.0.1
  ]) {
    it(`rejects blocked IPv6 literal ${host}`, async () => {
      await expect(assertUrlAllowed(`http://${host}/`, {}, publicLookup)).rejects.toThrow(
        /private, loopback, link-local, or metadata/,
      );
    });
  }

  it("accepts a public IPv6 literal", async () => {
    const url = await assertUrlAllowed("http://[2606:4700:4700::1111]/", {}, publicLookup);
    expect(url.hostname).toBe("[2606:4700:4700::1111]");
  });
});

describe("assertUrlAllowed — allowPrivateNetworks override", () => {
  it("permits a loopback literal when explicitly allowed", async () => {
    const url = await assertUrlAllowed(
      "http://127.0.0.1:8080/",
      { allowPrivateNetworks: true },
      internalLookup,
    );
    expect(url.hostname).toBe("127.0.0.1");
  });
});

describe("assertUrlAllowed — allowlist", () => {
  const allow = { urlAllowlist: ["example.com", ".corp.example.org"] };

  it("accepts an exact-host match", async () => {
    const url = await assertUrlAllowed("https://example.com/a", allow, publicLookup);
    expect(url.hostname).toBe("example.com");
  });

  it("accepts a dot-suffix subdomain match", async () => {
    const url = await assertUrlAllowed("https://wiki.corp.example.org/a", allow, publicLookup);
    expect(url.hostname).toBe("wiki.corp.example.org");
  });

  it("accepts the bare apex for a dot-suffix entry", async () => {
    const url = await assertUrlAllowed("https://corp.example.org/a", allow, publicLookup);
    expect(url.hostname).toBe("corp.example.org");
  });

  it("rejects a host not on the allowlist", async () => {
    await expect(
      assertUrlAllowed("https://notexample.com/a", allow, publicLookup),
    ).rejects.toThrow(/not in the configured allowlist/);
  });

  it("rejects a lookalike that only suffix-matches without the dot boundary", async () => {
    // "evilexample.com" must NOT match the exact entry "example.com".
    await expect(
      assertUrlAllowed("https://evilexample.com/a", allow, publicLookup),
    ).rejects.toThrow(/not in the configured allowlist/);
  });
});

describe("guardedFetch — redirect re-validation (SSRF)", () => {
  it("blocks a redirect that points at an internal IP", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call += 1;
      if (call === 1) {
        // First hop: a 302 to a loopback address.
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/secret" },
        });
      }
      return new Response("should never be reached", { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      guardedFetch("https://example.com/start", {}, { fetchImpl, lookup: publicLookup }),
    ).rejects.toThrow(/private, loopback, link-local, or metadata/);
    expect(call).toBe(1); // we never followed the redirect to fetch the internal host
  });

  it("returns the decoded body, final URL, and content-type on success", async () => {
    const fetchImpl = (async () =>
      new Response("<html><title>Hi</title></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as unknown as typeof fetch;

    const result = await guardedFetch(
      "https://example.com/page",
      {},
      { fetchImpl, lookup: publicLookup },
    );
    expect(result.body).toContain("<title>Hi</title>");
    expect(result.finalUrl).toBe("https://example.com/page");
    expect(result.contentType).toBe("text/html");
  });

  it("enforces maxBytes via the Content-Length short-circuit", async () => {
    const fetchImpl = (async () =>
      new Response("x".repeat(100), {
        status: 200,
        headers: { "content-type": "text/plain", "content-length": "100" },
      })) as unknown as typeof fetch;

    await expect(
      guardedFetch(
        "https://example.com/big",
        { maxBytes: 10 },
        { fetchImpl, lookup: publicLookup },
      ),
    ).rejects.toThrow(/over the 10-byte cap/);
  });
});

describe("assertPathAllowed — containment", () => {
  let root: string;
  let outside: string;

  beforeAll(() => {
    const base = mkdtempSync(join(tmpdir(), "ingest-sec-"));
    root = join(base, "ingest");
    outside = join(base, "outside");
    mkdirSync(root, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(root, "doc.txt"), "hello", "utf8");
    writeFileSync(join(outside, "secret.txt"), "nope", "utf8");
  });

  afterAll(() => {
    // Clean up the temp tree (parent of both root and outside).
    rmSync(resolve(root, ".."), { recursive: true, force: true });
  });

  it("passes a file genuinely inside the root", () => {
    const target = join(root, "doc.txt");
    // The guard returns the REAL (symlink-resolved) path, so on macOS the temp dir's
    // /var -> /private/var symlink is followed. Assert containment + basename, not a
    // raw string match against the un-resolved input.
    const result = assertPathAllowed(target, root);
    expect(result.endsWith(`ingest${sep}doc.txt`)).toBe(true);
  });

  it("rejects a `..` traversal that escapes the root", () => {
    const target = join(root, "..", "outside", "secret.txt");
    expect(() => assertPathAllowed(target, root)).toThrow(/outside the ingest root/);
  });

  it("rejects a sibling dir that only shares a name prefix (trailing-sep guard)", () => {
    // `${root}-evil` lexically startsWith `${root}` but is NOT contained.
    const evil = `${root}-evil`;
    mkdirSync(evil, { recursive: true });
    const target = join(evil, "x.txt");
    writeFileSync(target, "x", "utf8");
    try {
      expect(() => assertPathAllowed(target, root)).toThrow(/outside the ingest root/);
    } finally {
      rmSync(evil, { recursive: true, force: true });
    }
  });

  it("rejects a symlink inside the root that escapes it", () => {
    const link = join(root, "escape-link");
    symlinkSync(join(outside, "secret.txt"), link);
    try {
      expect(() => assertPathAllowed(link, root)).toThrow(/outside the ingest root/);
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("passes through (resolved absolute) when ingestRoot is undefined", () => {
    const result = assertPathAllowed("./some/rel/path.txt", undefined);
    expect(result.startsWith(sep)).toBe(true); // absolute
    expect(result.endsWith(`some${sep}rel${sep}path.txt`)).toBe(true);
  });
});
