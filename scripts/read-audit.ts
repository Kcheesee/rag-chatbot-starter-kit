/**
 * Shared helper for the reporting CLIs.
 *
 * `knowledge-health` and `audit-report` analyse the structured audit events the
 * audit logger emits. Those events go to a target (console / CloudWatch / S3 /
 * Splunk); to analyse them here, point the CLIs at a newline-delimited JSON dump.
 * In dev that's as simple as `AUDIT_LOG_TARGET=console npm run dev > logs/audit.ndjson`;
 * in production, export the relevant window from your SIEM to a file.
 */

import { readFile } from "node:fs/promises";

/** A parsed audit event. Only the common fields are typed; the rest are open. */
export interface AuditEventRecord {
  event_type: string;
  timestamp: string;
  namespace?: string;
  [key: string]: unknown;
}

/** Read and parse an NDJSON audit dump. Returns [] if the file is missing. */
export async function readAuditEvents(path: string): Promise<AuditEventRecord[]> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return [];
  }
  const events: AuditEventRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const parsed = JSON.parse(trimmed) as AuditEventRecord;
      if (typeof parsed.event_type === "string" && typeof parsed.timestamp === "string") {
        events.push(parsed);
      }
    } catch {
      // Skip non-JSON lines (e.g. interleaved app logs).
    }
  }
  return events;
}

/** Number → fixed-precision percentage string. */
export function pct(n: number, d: number): string {
  return d === 0 ? "0%" : `${((n / d) * 100).toFixed(1)}%`;
}
