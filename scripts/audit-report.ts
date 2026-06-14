/**
 * Audit-report CLI — summarise audit activity for a date range.
 *
 *   npm run audit-report -- --from 2026-06-01 --to 2026-06-14 --output ./reports
 *
 * Produces a structured report (query volume, cache performance, security events)
 * plus a NIST 800-53 continuous-monitoring evidence summary. Reads an NDJSON audit
 * dump (see scripts/read-audit.ts).
 */

import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { pct, readAuditEvents } from "./read-audit";

const program = new Command()
  .option("--from <iso>", "Start date (ISO). Default: 30 days ago")
  .option("--to <iso>", "End date (ISO). Default: now")
  .option("--namespace <ns>", "Scope to a namespace")
  .option("--input <path>", "NDJSON audit dump", "./logs/audit.ndjson")
  .option("--output <path>", "Write the report to this directory (default: stdout)")
  .parse(process.argv);

const opts = program.opts<{
  from?: string;
  to?: string;
  namespace?: string;
  input: string;
  output?: string;
}>();

const fromMs = opts.from ? Date.parse(opts.from) : Date.now() - 30 * 86_400_000;
const toMs = opts.to ? Date.parse(opts.to) : Date.now();

const events = (await readAuditEvents(opts.input)).filter((e) => {
  const t = Date.parse(e.timestamp);
  return t >= fromMs && t <= toMs && (!opts.namespace || e.namespace === opts.namespace);
});

const queries = events.filter((e) => e.event_type === "query");
const cacheEvents = events.filter((e) => e.event_type === "cache");
const securityEvents = events.filter((e) => e.event_type === "security");
const ingestEvents = events.filter((e) => e.event_type === "ingest");

const fromCache = queries.filter((q) => q.from_cache === true).length;
const escalated = queries.filter((q) => q.escalated === true).length;

function countBy(records: Array<Record<string, unknown>>, field: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const r of records) {
    const key = typeof r[field] === "string" ? (r[field] as string) : "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

const cacheByAction = [...countBy(cacheEvents, "action")].map(([k, v]) => `- ${k}: ${v}`).join("\n");
const securityByCategory = [...countBy(securityEvents, "category")]
  .map(([k, v]) => `- ${k}: ${v}`)
  .join("\n");

const report = `# Audit Report

Generated: ${new Date().toISOString()}
Range: ${new Date(fromMs).toISOString()} → ${new Date(toMs).toISOString()}
Namespace: ${opts.namespace ?? "all"}

## Query activity
- Total queries: ${queries.length}
- Served from cache: ${fromCache} (${pct(fromCache, queries.length)})
- Escalated (low-confidence fallback): ${escalated} (${pct(escalated, queries.length)})

## Cache performance
${cacheByAction || "- (no cache events)"}

## Security events
${securityByCategory || "- (none)"}

## Ingestion
- Ingest runs: ${ingestEvents.length}

## NIST 800-53 continuous-monitoring evidence (AU-2, AU-6, AU-12)
- Total audit records in range: ${events.length}
- Query events: ${queries.length} · Cache: ${cacheEvents.length} · Security: ${securityEvents.length} · Ingest: ${ingestEvents.length}
- Records carry no raw query/response text (hashes only when LOG_QUERY_HASHES=true), consistent with the audit logger's redaction policy.
- Retain per AUDIT_LOG_RETENTION_DAYS (1095 / 3 years in the federal example).
${events.length === 0 ? "\n> No events found in range. Point --input at an audit dump (see scripts/read-audit.ts)." : ""}
`;

if (opts.output) {
  await mkdir(opts.output, { recursive: true });
  const file = join(opts.output, `audit-report-${new Date().toISOString().slice(0, 10)}.md`);
  await writeFile(file, report, "utf8");
  process.stdout.write(`Wrote ${file}\n`);
} else {
  process.stdout.write(`${report}\n`);
}
