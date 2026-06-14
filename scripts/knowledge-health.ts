/**
 * Knowledge-health CLI — find the questions your knowledge base can't answer.
 *
 *   npm run knowledge-health -- --days 7 --output ./reports
 *
 * Scans an audit-event dump for low-confidence (fallback) queries — the questions
 * users are asking that your content doesn't cover — and emits a prioritised gap
 * report. Run it weekly. See scripts/read-audit.ts for how to produce the dump.
 */

import { Command } from "commander";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { loadEnv } from "@rag-chat-agent/rag-core";

import { pct, readAuditEvents } from "./read-audit";

const program = new Command()
  .option("--days <n>", "Look back N days", "7")
  .option("--namespace <ns>", "Scope to a namespace")
  .option("--input <path>", "NDJSON audit dump", "./logs/audit.ndjson")
  .option("--output <path>", "Write the report to this directory (default: stdout)")
  .option("--threshold <n>", "Confidence threshold to flag as a gap (default: from env)")
  .parse(process.argv);

const opts = program.opts<{
  days: string;
  namespace?: string;
  input: string;
  output?: string;
  threshold?: string;
}>();

const env = loadEnv();
const threshold = opts.threshold ? Number(opts.threshold) : env.MIN_RETRIEVAL_CONFIDENCE;
const days = Number(opts.days);
const sinceMs = Date.now() - days * 86_400_000;

const events = await readAuditEvents(opts.input);
const queries = events.filter(
  (e) =>
    e.event_type === "query" &&
    Date.parse(e.timestamp) >= sinceMs &&
    (!opts.namespace || e.namespace === opts.namespace),
);

const total = queries.length;
const cacheHits = queries.filter((q) => q.from_cache === true).length;
const escalations = queries.filter((q) => q.escalated === true).length;
const lowConf = queries.filter((q) => Number(q.retrieval_confidence) < threshold);

// Group low-confidence queries by hash to surface repeated gaps.
const byHash = new Map<string, { count: number; confidenceSum: number }>();
for (const q of lowConf) {
  const key = typeof q.query_hash === "string" ? q.query_hash : "(unhashed)";
  const entry = byHash.get(key) ?? { count: 0, confidenceSum: 0 };
  entry.count += 1;
  entry.confidenceSum += Number(q.retrieval_confidence) || 0;
  byHash.set(key, entry);
}
const top = [...byHash.entries()]
  .sort((a, b) => b[1].count - a[1].count)
  .slice(0, 20)
  .map(([hash, e]) => `| ${e.count} | \`${hash.slice(0, 16)}\` | ${(e.confidenceSum / e.count).toFixed(2)} |`);

const report = `# Knowledge Health Report

Generated: ${new Date().toISOString()}
Window: last ${days} day(s) · Namespace: ${opts.namespace ?? "all"} · Gap threshold: ${threshold}

- **Total queries:** ${total}
- **Cache hit rate:** ${pct(cacheHits, total)}
- **Escalation rate:** ${pct(escalations, total)}
- **Low-confidence (gap) queries:** ${lowConf.length} (${pct(lowConf.length, total)})

## Top gap topics (most-repeated low-confidence queries)

| Count | Query hash | Avg confidence |
|---|---|---|
${top.length > 0 ? top.join("\n") : "| — | — | — |"}

## Recommended actions

- Add or expand source documents covering the repeated gap topics above.
- If the escalation rate is climbing, the knowledge base is drifting from what users ask — schedule a coverage review.
- Re-ingest updated sources with \`npm run ingest\`; the response cache re-grounds automatically.
${total === 0 ? "\n> No query events found. Point --input at an audit dump (see scripts/read-audit.ts)." : ""}
`;

if (opts.output) {
  await mkdir(opts.output, { recursive: true });
  const file = join(opts.output, `knowledge-gaps-${new Date().toISOString().slice(0, 10)}.md`);
  await writeFile(file, report, "utf8");
  process.stdout.write(`Wrote ${file}\n`);
} else {
  process.stdout.write(`${report}\n`);
}
