/**
 * Loader hardening: SSRF + arbitrary-file-read defenses for the URL, sitemap, and
 * file loaders.
 *
 * WHY this module exists: the ingestion loaders fetch operator-supplied URLs and read
 * operator-supplied paths. In a hosted/admin context (the admin ingest route) those
 * inputs are effectively attacker-influenced, so a naive `fetch(url)` is a textbook
 * Server-Side Request Forgery sink — an attacker points the crawler at
 * `http://169.254.169.254/…` (cloud metadata), `http://127.0.0.1:…` (internal admin
 * ports), or a public hostname whose DNS record resolves to an internal IP, and the
 * server happily relays the response back. Likewise a file loader pointed at
 * `../../etc/passwd` is an arbitrary-file-read sink.
 *
 * The three exported guards here are the single source of truth for those checks:
 *  - {@link assertUrlAllowed}  — scheme / allowlist / private-IP gate for one URL.
 *  - {@link guardedFetch}      — a fetch that re-applies that gate on EVERY redirect hop,
 *                                plus size + timeout caps.
 *  - {@link assertPathAllowed} — `..`/symlink containment for file paths.
 *
 * All defaults are deny-by-default and overridable through {@link LoaderSecurity} so the
 * trusted CLI can opt into private networks / local paths while the hosted route stays
 * locked down.
 */

import { resolve, sep } from "node:path";
import { realpathSync } from "node:fs";
import { lookup as dnsLookup } from "node:dns/promises";

/**
 * Operator-tunable security policy threaded through every network/file loader.
 *
 * Every field is optional; sensible deny-by-default values are filled in by
 * {@link resolveSecurity}. Pass an empty object (`{}`) to accept the safe defaults.
 */
export interface LoaderSecurity {
  /**
   * Allow fetches whose (resolved) host is a private / loopback / link-local /
   * unique-local / cloud-metadata IP. Default `false`. Set `true` ONLY for the trusted
   * local CLI crawling an intranet — never for a hosted/admin ingest surface, where it
   * re-opens the SSRF hole this module closes.
   */
  allowPrivateNetworks?: boolean;
  /**
   * If set, the fetch host MUST match one of these entries. An entry is either an exact
   * host (`example.com`) or a leading-dot suffix (`.example.com`, which matches
   * `a.example.com` and `example.com` itself). When unset, any *public* host is allowed
   * (still subject to the private-IP checks). An empty array allows nothing.
   */
  urlAllowlist?: string[];
  /**
   * Filesystem root that file loaders are confined to. When set, every resolved file
   * path must live inside it (after `..`/symlink resolution). When unset, local paths
   * are trusted unchanged — the default, because the CLI legitimately reads anywhere.
   */
  ingestRoot?: string;
  /**
   * Hard cap on a fetched body, in bytes. Default 10_000_000 (10 MB). Protects against
   * decompression-bomb / unbounded-response memory exhaustion.
   */
  maxBytes?: number;
  /**
   * Per-fetch timeout in milliseconds, enforced via `AbortController`. Default 15_000.
   * Stops a slow-loris endpoint from hanging the crawl.
   */
  timeoutMs?: number;
  /**
   * Maximum number of redirect hops to follow manually. Default 3. Each hop is
   * re-validated by {@link assertUrlAllowed}; see {@link guardedFetch} for why automatic
   * redirects are disabled.
   */
  maxRedirects?: number;
}

/** Fully-resolved policy with all defaults applied. */
interface ResolvedSecurity {
  allowPrivateNetworks: boolean;
  urlAllowlist: string[] | undefined;
  ingestRoot: string | undefined;
  maxBytes: number;
  timeoutMs: number;
  maxRedirects: number;
}

const DEFAULT_MAX_BYTES = 10_000_000; // 10 MB
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

/**
 * Minimal structural view of one `dns.lookup(host, { all: true })` entry.
 *
 * WHY structural: it lets tests inject a fake resolver (see {@link DnsLookup}) without
 * pulling in `@types/node`'s `LookupAddress` and without any real DNS traffic.
 */
interface ResolvedAddress {
  address: string;
  family: number;
}

/**
 * The DNS seam. Real callers get `node:dns/promises` `lookup(host, { all: true })`;
 * tests pass a stub. Kept as a parameter (not a global mock) so the dependency is
 * explicit and the unit under test stays deterministic.
 */
export type DnsLookup = (hostname: string) => Promise<ResolvedAddress[]>;

const defaultDnsLookup: DnsLookup = (hostname) => dnsLookup(hostname, { all: true });

/** Apply deny-by-default values to a partial policy. */
function resolveSecurity(sec: LoaderSecurity): ResolvedSecurity {
  return {
    allowPrivateNetworks: sec.allowPrivateNetworks ?? false,
    urlAllowlist: sec.urlAllowlist,
    ingestRoot: sec.ingestRoot,
    maxBytes: sec.maxBytes ?? DEFAULT_MAX_BYTES,
    timeoutMs: sec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxRedirects: sec.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
  };
}

const POINTER = "See CONFIG.md#ingestion.";

// ---------------------------------------------------------------------------
// IP literal classification
// ---------------------------------------------------------------------------

/** Parse a dotted-quad into its four octets, or `null` if it is not IPv4. */
function parseIPv4(host: string): [number, number, number, number] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Reject empties, signs, and non-digits — only canonical 0-255 decimals.
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    octets.push(n);
  }
  return [octets[0]!, octets[1]!, octets[2]!, octets[3]!];
}

/**
 * Is this IPv4 address in a range we refuse to fetch (unless private nets are allowed)?
 *
 * Covers, in order: 0.0.0.0/8 ("this host"), 10/8, 100.64/10 (CGNAT), 127/8 (loopback),
 * 169.254/16 (link-local, which includes 169.254.169.254 cloud metadata), 172.16/12,
 * and 192.168/16. The metadata IP is also called out explicitly below for documentation,
 * though 169.254/16 already subsumes it.
 */
function isBlockedIPv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets;
  if (a === 0) return true; // 0.0.0.0/8 — unspecified / "this host"
  if (a === 10) return true; // 10.0.0.0/8 — private
  if (a === 127) return true; // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 — link-local + 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 — private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 — private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 — CGNAT (RFC 6598)
  return false;
}

/**
 * Normalize an IPv6 literal (strip a `[...]` zone wrapper and `%scope` suffix) and lower-case.
 */
function normalizeIPv6(host: string): string {
  let h = host;
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  const pct = h.indexOf("%");
  if (pct !== -1) h = h.slice(0, pct);
  return h.toLowerCase();
}

/**
 * Is this IPv6 address blocked? Handles loopback (`::1`), unspecified (`::`),
 * unique-local `fc00::/7` (`fc`/`fd` first byte), link-local `fe80::/10`, and
 * IPv4-mapped `::ffff:a.b.c.d` — which we UNWRAP and re-check as IPv4 so an attacker
 * cannot smuggle 127.0.0.1 past the v6 path.
 */
function isBlockedIPv6(raw: string): boolean {
  const h = normalizeIPv6(raw);

  if (h === "::1") return true; // loopback
  if (h === "::") return true; // unspecified

  // IPv4-mapped (::ffff:127.0.0.1) and IPv4-compatible (::127.0.0.1): unwrap the
  // trailing dotted-quad and re-run the IPv4 classifier.
  const mappedMatch = /^(?:::ffff:|::)((?:\d{1,3}\.){3}\d{1,3})$/.exec(h);
  if (mappedMatch) {
    const v4 = parseIPv4(mappedMatch[1]!);
    if (v4 && isBlockedIPv4(v4)) return true;
  }
  // Also handle the hex-encoded form of ::ffff:a.b.c.d, e.g. ::ffff:7f00:0001.
  const hexMappedMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
  if (hexMappedMatch) {
    const hi = parseInt(hexMappedMatch[1]!, 16);
    const lo = parseInt(hexMappedMatch[2]!, 16);
    const v4: [number, number, number, number] = [
      (hi >> 8) & 0xff,
      hi & 0xff,
      (lo >> 8) & 0xff,
      lo & 0xff,
    ];
    if (isBlockedIPv4(v4)) return true;
  }

  // First hextet tells us about fc00::/7 and fe80::/10.
  const firstHextet = h.split(":")[0] ?? "";
  if (firstHextet.length > 0) {
    const val = parseInt(firstHextet, 16);
    if (!Number.isNaN(val)) {
      const highByte = (val >> 8) & 0xff;
      if (highByte === 0xfc || highByte === 0xfd) return true; // fc00::/7 unique-local
      if (highByte === 0xfe && (val & 0xc0) === 0x80) return true; // fe80::/10 link-local
    }
  }

  return false;
}

/** Heuristic: does this host string look like an IPv6 literal (contains a colon)? */
function looksLikeIPv6(host: string): boolean {
  return normalizeIPv6(host).includes(":");
}

/**
 * Classify one IP literal (v4 or v6) as blocked. Non-IP strings return `false` here —
 * hostnames are handled separately (allowlist + DNS resolution) by {@link assertUrlAllowed}.
 */
function isBlockedIpLiteral(host: string): boolean {
  const v4 = parseIPv4(host);
  if (v4) return isBlockedIPv4(v4);
  if (looksLikeIPv6(host)) return isBlockedIPv6(host);
  return false;
}

/** True iff `host` is an IP literal (v4 or v6), not a DNS hostname. */
function isIpLiteral(host: string): boolean {
  return parseIPv4(host) !== null || looksLikeIPv6(host);
}

// ---------------------------------------------------------------------------
// Allowlist matching
// ---------------------------------------------------------------------------

/**
 * Does `host` satisfy the allowlist? An entry matches when it equals the host exactly,
 * OR it begins with a dot and the host ends with it (`.example.com` ⇒ `a.example.com`
 * and bare `example.com`). Matching is case-insensitive.
 */
function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  const h = host.toLowerCase();
  for (const entryRaw of allowlist) {
    const entry = entryRaw.toLowerCase();
    if (entry.startsWith(".")) {
      const bare = entry.slice(1);
      if (h === bare || h.endsWith(entry)) return true;
    } else if (h === entry) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Public guards
// ---------------------------------------------------------------------------

/**
 * Validate `rawUrl` against the policy and return the parsed {@link URL}, or throw.
 *
 * Synchronous IP-literal checks happen inline. For DNS hostnames, this resolves the name
 * (via `node:dns/promises` `lookup(..., { all: true })`, or the injected {@link DnsLookup}
 * seam in tests) and applies the SAME private-IP gate to EVERY resolved address — that is
 * the DNS-rebinding / public-name-points-at-internal-IP defense.
 *
 * WHY async: hostname safety cannot be decided without resolving it, and we must check the
 * real addresses, not trust the name.
 *
 * @throws if the scheme is not http/https, the host is not allowlisted (when an allowlist
 *   is set), or the host (literal or any resolved address) is in a blocked range.
 */
export async function assertUrlAllowed(
  rawUrl: string,
  sec: LoaderSecurity,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<URL> {
  const resolved = resolveSecurity(sec);

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL "${rawUrl}". ${POINTER}`);
  }

  // 1) Scheme gate — only http/https. Blocks file:, ftp:, gopher:, data:, etc.
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `Refusing to fetch "${rawUrl}": only http/https are allowed, got "${url.protocol}". ${POINTER}`,
    );
  }

  // `URL.hostname` keeps IPv6 in brackets; strip them for classification.
  const host = url.hostname;
  const bareHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  // 2) Allowlist gate — when set, the host must match it (applies to literals too).
  if (resolved.urlAllowlist !== undefined) {
    if (!hostMatchesAllowlist(bareHost, resolved.urlAllowlist)) {
      throw new Error(
        `Refusing to fetch "${rawUrl}": host "${bareHost}" is not in the configured allowlist. ${POINTER}`,
      );
    }
  }

  if (resolved.allowPrivateNetworks) {
    // Operator explicitly trusts private networks; skip the IP-range gate entirely.
    return url;
  }

  // 3a) IP literal: classify directly, no DNS.
  if (isIpLiteral(bareHost)) {
    if (isBlockedIpLiteral(bareHost)) {
      throw new Error(
        `Refusing to fetch "${rawUrl}": host "${bareHost}" is a private, loopback, ` +
          `link-local, or metadata address. ${POINTER}`,
      );
    }
    return url;
  }

  // 3b) DNS hostname: resolve and apply the IP gate to EVERY answer. A public name that
  // resolves to an internal IP is still rejected (DNS-rebinding defense).
  let addresses: ResolvedAddress[];
  try {
    addresses = await lookup(bareHost);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Failed to resolve host "${bareHost}" for "${rawUrl}": ${reason}. ${POINTER}`);
  }

  if (addresses.length === 0) {
    throw new Error(`Host "${bareHost}" for "${rawUrl}" resolved to no addresses. ${POINTER}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIpLiteral(address)) {
      throw new Error(
        `Refusing to fetch "${rawUrl}": host "${bareHost}" resolves to a private, ` +
          `loopback, link-local, or metadata address (${address}). ${POINTER}`,
      );
    }
  }

  return url;
}

/**
 * Fetch `rawUrl` with the full SSRF gauntlet: initial-URL validation, MANUAL redirect
 * following with per-hop re-validation, a request timeout, and a body-size cap.
 *
 * WHY manual redirects (`redirect: "manual"`): global `fetch`'s automatic redirect
 * following would chase a `Location:` header WITHOUT re-running {@link assertUrlAllowed},
 * so an allowlisted public URL could 302 you straight to `http://169.254.169.254/…`.
 * Following hops by hand and re-validating each one is the critical redirect-SSRF defense.
 *
 * @returns the decoded text body, the final (post-redirect) URL, and the content-type.
 * @throws on disallowed URL/redirect target, timeout, oversize body, or non-2xx status.
 */
export async function guardedFetch(
  rawUrl: string,
  sec: LoaderSecurity,
  deps: { fetchImpl?: typeof fetch; lookup?: DnsLookup } = {},
): Promise<{ body: string; finalUrl: string; contentType: string | undefined }> {
  const resolved = resolveSecurity(sec);
  const doFetch = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultDnsLookup;

  // Validate the entry point before we touch the network.
  let current = await assertUrlAllowed(rawUrl, sec, lookup);

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, resolved.timeoutMs);

  try {
    for (let hop = 0; hop <= resolved.maxRedirects; hop++) {
      let res: Response;
      try {
        res = await doFetch(current.toString(), {
          redirect: "manual",
          signal: controller.signal,
        });
      } catch (cause) {
        if (controller.signal.aborted) {
          throw new Error(
            `Timed out fetching "${current.toString()}" after ${resolved.timeoutMs}ms. ${POINTER}`,
          );
        }
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Failed to fetch "${current.toString()}": ${reason}. ${POINTER}`);
      }

      // Manual redirect: status 3xx with a Location. `fetch` reports these as either a
      // 3xx status or an opaqueredirect type depending on the platform; handle both.
      const isRedirect =
        res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400);
      if (isRedirect) {
        const location = res.headers.get("location");
        if (!location) {
          throw new Error(
            `Redirect from "${current.toString()}" had no Location header. ${POINTER}`,
          );
        }
        if (hop === resolved.maxRedirects) {
          throw new Error(
            `Too many redirects fetching "${rawUrl}" (cap ${resolved.maxRedirects}). ${POINTER}`,
          );
        }
        // Resolve relative redirects against the current URL, then RE-VALIDATE.
        const next = new URL(location, current).toString();
        current = await assertUrlAllowed(next, sec, lookup);
        continue;
      }

      if (!res.ok) {
        throw new Error(
          `Failed to fetch "${current.toString()}": HTTP ${res.status} ${res.statusText}. ${POINTER}`,
        );
      }

      // Short-circuit on an honest, too-large Content-Length before reading the body.
      const declaredLength = res.headers.get("content-length");
      if (declaredLength !== null) {
        const declared = Number(declaredLength);
        if (Number.isFinite(declared) && declared > resolved.maxBytes) {
          throw new Error(
            `Response from "${current.toString()}" is ${declared} bytes, over the ` +
              `${resolved.maxBytes}-byte cap. ${POINTER}`,
          );
        }
      }

      const contentType = res.headers.get("content-type") ?? undefined;
      const body = await readCapped(res, resolved.maxBytes, controller, current.toString());
      return { body, finalUrl: current.toString(), contentType };
    }

    // Unreachable: the loop either returns a body or throws, but TS needs a terminus.
    throw new Error(`Too many redirects fetching "${rawUrl}" (cap ${resolved.maxRedirects}). ${POINTER}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read a response body, aborting the moment it exceeds `maxBytes`.
 *
 * WHY stream rather than `res.text()`: a lying or absent Content-Length means the only
 * trustworthy cap is to count bytes as they arrive and bail early — otherwise a
 * 10-GB chunked response would be fully buffered before we ever saw its size.
 */
async function readCapped(
  res: Response,
  maxBytes: number,
  controller: AbortController,
  urlForError: string,
): Promise<string> {
  const reader = res.body?.getReader();

  // No stream (e.g. a mocked Response): fall back to text(), then enforce the cap.
  if (!reader) {
    const text = await res.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error(
        `Response from "${urlForError}" exceeded the ${maxBytes}-byte cap. ${POINTER}`,
      );
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        controller.abort(); // stop the transfer immediately
        throw new Error(
          `Response from "${urlForError}" exceeded the ${maxBytes}-byte cap. ${POINTER}`,
        );
      }
      chunks.push(value);
    }
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Confine a file path to `ingestRoot`, defending against `..` traversal and symlink escape.
 *
 * When `ingestRoot` is `undefined`, the path is merely resolved to absolute and returned —
 * the local CLI is trusted to read anywhere. When set, BOTH the root and the target are
 * resolved to their real (symlink-followed) absolute paths, and the target must sit inside
 * the root. The containment test uses a trailing-separator prefix (`root + sep`) rather than
 * a bare `startsWith`, so `/data/ingest-evil` cannot pose as a child of `/data/ingest`.
 *
 * @returns the resolved (real) absolute path of `target`.
 * @throws if `target` escapes `ingestRoot`.
 */
export function assertPathAllowed(target: string, ingestRoot: string | undefined): string {
  if (ingestRoot === undefined) {
    // Trusted local use: no containment, just normalize to absolute. `resolve` already
    // returns absolute paths unchanged and resolves relative ones against the cwd.
    return resolve(target);
  }

  // Resolve the root's real path; the root itself must exist.
  let realRoot: string;
  try {
    realRoot = realpathSync(resolve(ingestRoot));
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`ingestRoot "${ingestRoot}" could not be resolved: ${reason}. ${POINTER}`);
  }

  const absTarget = resolve(target);

  // Resolve the target's real path when it exists; if it does not (yet), fall back to the
  // lexically-resolved absolute path so a missing-but-contained path still passes the check.
  let realTarget: string;
  try {
    realTarget = realpathSync(absTarget);
  } catch {
    realTarget = absTarget;
  }

  // Containment: equal to the root, or under `root + sep` (trailing-separator guard).
  const rootWithSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
  if (realTarget !== realRoot && !realTarget.startsWith(rootWithSep)) {
    throw new Error(
      `Refusing to read "${target}": resolved path "${realTarget}" is outside the ` +
        `ingest root "${realRoot}". ${POINTER}`,
    );
  }

  return realTarget;
}
