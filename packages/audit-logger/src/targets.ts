/**
 * Audit record sinks.
 *
 * Every target accepts a fully-formed, already-redacted record (a plain JSON
 * object). The console target writes synchronously; the network targets buffer and
 * flush in batches so logging never blocks the request path. AWS SDK clients are
 * imported lazily so a console-only (commercial) deployment never loads them.
 */

import type { AuditLoggerConfig } from "./config";

/** A serialised audit record ready to write. */
export type AuditRecord = Record<string, unknown>;

/** The sink contract. `flush`/`close` let the app drain buffers on shutdown. */
export interface AuditTarget {
  write(record: AuditRecord): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

/** Writes one JSON object per line to stdout. The default, dependency-free target. */
export class ConsoleAuditTarget implements AuditTarget {
  write(record: AuditRecord): void {
    process.stdout.write(`${JSON.stringify(record)}\n`);
  }
  async flush(): Promise<void> {}
  async close(): Promise<void> {}
}

/**
 * Base class for network targets: collects records and ships them in batches.
 * A failed flush logs to stderr and drops the batch rather than throwing into the
 * caller — audit emission must never take down the request that triggered it.
 */
export abstract class BufferedAuditTarget implements AuditTarget {
  protected readonly buffer: AuditRecord[] = [];
  private flushing = false;

  constructor(protected readonly maxBuffer = 100) {}

  write(record: AuditRecord): void {
    this.buffer.push(record);
    if (this.buffer.length >= this.maxBuffer) {
      void this.flush();
    }
  }

  /** Ship a batch to the backend. Implemented per target. */
  protected abstract send(batch: AuditRecord[]): Promise<void>;

  async flush(): Promise<void> {
    if (this.flushing || this.buffer.length === 0) return;
    this.flushing = true;
    const batch = this.buffer.splice(0, this.buffer.length);
    try {
      await this.send(batch);
    } catch (err) {
      // Never propagate: re-buffer the batch for the next flush attempt.
      this.buffer.unshift(...batch);
      process.stderr.write(`[audit-logger] flush to backend failed: ${String(err)}\n`);
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    await this.flush();
  }
}

/** Ships records to a CloudWatch Logs stream (NIST AU-2/AU-12 evidence store). */
export class CloudWatchAuditTarget extends BufferedAuditTarget {
  // Loosely typed because the SDK is imported lazily; constructed on first send.
  private client: unknown;

  constructor(private readonly cfg: NonNullable<AuditLoggerConfig["cloudwatch"]>) {
    super();
  }

  protected async send(batch: AuditRecord[]): Promise<void> {
    const { CloudWatchLogsClient, PutLogEventsCommand, CreateLogStreamCommand, CreateLogGroupCommand } =
      await import("@aws-sdk/client-cloudwatch-logs");

    if (!this.client) {
      // Credentials resolve from the default provider chain (IAM task role in
      // GovCloud) — never a static key.
      this.client = new CloudWatchLogsClient({ region: this.cfg.region });
    }
    const client = this.client as InstanceType<typeof CloudWatchLogsClient>;

    const logEvents = batch.map((record) => ({
      timestamp: this.recordMillis(record),
      message: JSON.stringify(record),
    }));

    const put = new PutLogEventsCommand({
      logGroupName: this.cfg.logGroup,
      logStreamName: this.cfg.logStream,
      logEvents,
    });

    try {
      await client.send(put);
    } catch (err) {
      // First write to a fresh group/stream: create them, then retry once.
      if (this.isResourceNotFound(err)) {
        await client
          .send(new CreateLogGroupCommand({ logGroupName: this.cfg.logGroup }))
          .catch(() => undefined);
        await client
          .send(
            new CreateLogStreamCommand({
              logGroupName: this.cfg.logGroup,
              logStreamName: this.cfg.logStream,
            }),
          )
          .catch(() => undefined);
        await client.send(put);
      } else {
        throw err;
      }
    }
  }

  private recordMillis(record: AuditRecord): number {
    const ts = record["timestamp"];
    const parsed = typeof ts === "string" ? Date.parse(ts) : NaN;
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  private isResourceNotFound(err: unknown): boolean {
    return Boolean(err) && (err as { name?: string }).name === "ResourceNotFoundException";
  }
}

/** Writes each flushed batch as a single NDJSON object under an S3 prefix. */
export class S3AuditTarget extends BufferedAuditTarget {
  private client: unknown;

  constructor(private readonly cfg: NonNullable<AuditLoggerConfig["s3"]>) {
    super();
  }

  protected async send(batch: AuditRecord[]): Promise<void> {
    const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
    if (!this.client) {
      this.client = new S3Client({ region: this.cfg.region });
    }
    const client = this.client as InstanceType<typeof S3Client>;

    const body = `${batch.map((r) => JSON.stringify(r)).join("\n")}\n`;
    const now = new Date();
    const key =
      `${this.cfg.prefix.replace(/\/$/, "")}/` +
      `${now.toISOString().slice(0, 10)}/audit-${now.getTime()}.ndjson`;

    await client.send(
      new PutObjectCommand({
        Bucket: this.cfg.bucket,
        Key: key,
        Body: body,
        ContentType: "application/x-ndjson",
      }),
    );
  }
}

/** Ships records to a Splunk HTTP Event Collector. Uses global fetch (Node 18+). */
export class SplunkAuditTarget extends BufferedAuditTarget {
  constructor(private readonly cfg: NonNullable<AuditLoggerConfig["splunk"]>) {
    super();
  }

  protected async send(batch: AuditRecord[]): Promise<void> {
    // HEC accepts newline-delimited event envelopes in a single request.
    const payload = batch
      .map((record) =>
        JSON.stringify({
          event: record,
          sourcetype: this.cfg.sourcetype ?? "rag-chat-agent:audit",
          ...(this.cfg.index ? { index: this.cfg.index } : {}),
        }),
      )
      .join("\n");

    const res = await fetch(`${this.cfg.url.replace(/\/$/, "")}/services/collector/event`, {
      method: "POST",
      headers: {
        Authorization: `Splunk ${this.cfg.token}`,
        "Content-Type": "application/json",
      },
      body: payload,
    });

    if (!res.ok) {
      throw new Error(`Splunk HEC responded ${res.status} ${res.statusText}`);
    }
  }
}

/**
 * Construct the configured target. Throws a clear, CONFIG.md-pointing error when a
 * federal target is selected without its required settings — fail fast, don't
 * silently drop audit records.
 */
export function createTarget(config: AuditLoggerConfig): AuditTarget {
  switch (config.target) {
    case "console":
      return new ConsoleAuditTarget();
    case "cloudwatch":
      if (!config.cloudwatch) {
        throw new Error(
          "AUDIT_LOG_TARGET=cloudwatch requires CloudWatch settings (region, log group, " +
            "log stream). See CONFIG.md#audit-logging.",
        );
      }
      return new CloudWatchAuditTarget(config.cloudwatch);
    case "s3":
      if (!config.s3) {
        throw new Error(
          "AUDIT_LOG_TARGET=s3 requires S3 settings (region, bucket, prefix). " +
            "See CONFIG.md#audit-logging.",
        );
      }
      return new S3AuditTarget(config.s3);
    case "splunk":
      if (!config.splunk) {
        throw new Error(
          "AUDIT_LOG_TARGET=splunk requires Splunk HEC settings (url, token). " +
            "See CONFIG.md#audit-logging.",
        );
      }
      return new SplunkAuditTarget(config.splunk);
    default: {
      // Exhaustiveness guard: a new AuditLogTarget must be handled here.
      const exhaustive: never = config.target;
      throw new Error(`Unknown AUDIT_LOG_TARGET: ${String(exhaustive)}`);
    }
  }
}
