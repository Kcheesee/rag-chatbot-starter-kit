import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createAuditLogger,
  getAuditLogger,
  hashText,
  initAuditLogger,
  NoOpAuditLogger,
  resetAuditLogger,
  type AuditLoggerConfig,
  type QueryEvent,
} from "../index";
import { createTarget } from "../targets";

/** A baseline config with emission ON and a console sink. */
function config(overrides: Partial<AuditLoggerConfig> = {}): AuditLoggerConfig {
  return {
    enabled: true,
    target: "console",
    environment: "test",
    deploymentMode: "standard",
    logQueryHashes: true,
    logResponses: false,
    retentionDays: 90,
    ...overrides,
  };
}

function queryEvent(overrides: Partial<QueryEvent> = {}): QueryEvent {
  return {
    timestamp: "2026-06-13T00:00:00.000Z",
    event_type: "query",
    session_id: "sess_1",
    latency_ms: 42,
    environment: "test",
    deployment_mode: "standard",
    namespace: "acme",
    query_hash: hashText("what is the refund policy?"),
    retrieval_confidence: 0.88,
    from_cache: false,
    escalated: false,
    source_count: 3,
    model: "claude-sonnet-4-6",
    ...overrides,
  };
}

/** Capture everything written to stdout during a logger call. */
function captureStdout(fn: () => void): string[] {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
    writes.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  });
  try {
    fn();
  } finally {
    spy.mockRestore();
  }
  return writes;
}

afterEach(() => {
  resetAuditLogger();
  vi.restoreAllMocks();
});

describe("hashText", () => {
  it("produces a stable 64-char hex sha256", () => {
    const h = hashText("hello");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashText("hello")).toBe(h);
    expect(hashText("hello!")).not.toBe(h);
  });
});

describe("StructuredAuditLogger", () => {
  it("emits a JSON line carrying the event's metadata fields", () => {
    const logger = createAuditLogger(config());
    const writes = captureStdout(() => logger.logQuery(queryEvent()));

    expect(writes).toHaveLength(1);
    const record = JSON.parse(writes[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      event_type: "query",
      session_id: "sess_1",
      namespace: "acme",
      retrieval_confidence: 0.88,
      deployment_mode: "standard",
    });
  });

  it("includes query_hash but never raw query text", () => {
    const logger = createAuditLogger(config({ logQueryHashes: true }));
    const writes = captureStdout(() => logger.logQuery(queryEvent()));
    const line = writes[0]!;

    expect(line).toContain(hashText("what is the refund policy?"));
    // The raw question must never appear in an audit record.
    expect(line).not.toContain("refund policy");
  });

  it("strips query_hash when LOG_QUERY_HASHES is off", () => {
    const logger = createAuditLogger(config({ logQueryHashes: false }));
    const writes = captureStdout(() => logger.logQuery(queryEvent()));
    const record = JSON.parse(writes[0]!) as Record<string, unknown>;

    expect(record).not.toHaveProperty("query_hash");
    expect(record.event_type).toBe("query");
  });

  it("strips any response-bearing field when LOG_RESPONSES is off", () => {
    const logger = createAuditLogger(config({ logResponses: false }));
    // Simulate a future/misbehaving caller that attaches an answer.
    const event = { ...queryEvent(), answer: "Refunds are processed in 30 days." } as QueryEvent;
    const writes = captureStdout(() => logger.logQuery(event));
    const line = writes[0]!;

    expect(line).not.toContain("Refunds are processed");
    expect(JSON.parse(line)).not.toHaveProperty("answer");
  });
});

describe("createAuditLogger", () => {
  it("returns a no-op (and emits nothing) when disabled", () => {
    const logger = createAuditLogger(config({ enabled: false }));
    expect(logger).toBeInstanceOf(NoOpAuditLogger);
    const writes = captureStdout(() => logger.logQuery(queryEvent()));
    expect(writes).toHaveLength(0);
  });
});

describe("singleton", () => {
  it("getAuditLogger returns a disabled default before init", () => {
    const logger = getAuditLogger();
    const writes = captureStdout(() => logger.logQuery(queryEvent()));
    expect(writes).toHaveLength(0);
  });

  it("initAuditLogger installs an enabled logger", () => {
    initAuditLogger(config());
    const writes = captureStdout(() => getAuditLogger().logQuery(queryEvent()));
    expect(writes).toHaveLength(1);
  });
});

describe("createTarget", () => {
  it("builds a console target", () => {
    expect(createTarget(config({ target: "console" }))).toBeDefined();
  });

  it("fails fast when a federal target lacks its settings", () => {
    expect(() => createTarget(config({ target: "cloudwatch" }))).toThrow(/cloudwatch/i);
    expect(() => createTarget(config({ target: "s3" }))).toThrow(/s3/i);
    expect(() => createTarget(config({ target: "splunk" }))).toThrow(/splunk/i);
  });
});
