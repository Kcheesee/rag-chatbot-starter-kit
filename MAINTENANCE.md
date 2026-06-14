# Maintenance Guide

> The standalone, expanded ops guide for the [Lifecycle and maintenance](./README.md#lifecycle-and-maintenance) section of the README. If you only read one file after launch, read this one.

**A RAG chatbot is not a website you launch and leave.** It is a live system built on a knowledge base that goes stale, a model that gets updated, and a user population whose questions evolve. Treat it as a one-time deployment and you end up with a bot that confidently answers from superseded policy, misses topics that were never ingested, and quietly drifts out of accessibility compliance as the UI gets patched.

This guide is the ongoing-ownership manual: the concrete, command-oriented work that keeps the system **accurate, secure, and compliant** after go-live. Every command here is real and runnable from the repo root. The reporting CLIs (`audit-report`, `knowledge-health`) analyse the structured events the audit logger emits — see [Where the signals come from](#where-the-signals-come-from) below.

---

## 1. Knowledge base maintenance

The knowledge base is the single most important thing to maintain and the most commonly neglected. Everything the bot says is grounded in it; if it is stale, the bot is confidently wrong.

### Document freshness and owners

Every source document has an effective date and a real-world owner. When a policy is updated, guidance is superseded, or a regulation is published, the corresponding chunks in the vector store are now wrong — and the bot has **no way to know** unless you re-ingest. Stale chunks do not error; they produce fluent, cited, outdated answers.

Assign a **document owner** to every ingested source. That owner is accountable for triggering a re-ingest whenever their source changes. Track this in whatever you already use (a spreadsheet, the source repo's CODEOWNERS, an admin sheet) — the point is that no source is orphaned.

### Re-ingest on source change (per-namespace)

`scripts/ingest.ts` takes a `--namespace` flag, so one document set updates **without re-ingesting everything**. Re-ingesting only the namespace that changed is faster, cheaper, and lower-risk than a full rebuild.

```bash
# Re-ingest one source set after it changes — only this namespace is touched
npm run ingest -- --source ./docs/hr-handbook --type pdf,md --namespace hr-handbook

# A URL / sitemap source
npm run ingest -- --source https://agency.gov/policies --type url --namespace public-policy

# Validate parsing + chunking without embedding or writing (no embeddings key needed)
npm run ingest -- --source ./docs/hr-handbook --type pdf,md --namespace hr-handbook --dry-run
```

Supported `--type` values: `pdf,md,docx,txt,url,sitemap,notion,confluence`. Notion/Confluence read credentials from the environment (`NOTION_TOKEN`, `CONFLUENCE_*`). Chunk size/overlap default from env but can be overridden per run with `--chunk-size` / `--chunk-overlap`. Every run writes an ingest audit event.

> Re-ingesting **updates chunks in place** — the same chunk id is rewritten with new content and a new content hash (`ON CONFLICT … DO UPDATE` on pgvector; equivalent upsert on the other adapters). You do not need to delete the old namespace first.

### The response cache re-grounds automatically after re-ingest

You do **not** manually clear the cache after re-ingesting. Stale answers cannot be served because of the **content-hash grounding check**:

- When an answer is cached, the cache entry records the **id and `contentHash` (sha256 of the chunk text)** of every source chunk the answer was built from.
- On every cache **hit**, before serving, the pipeline re-reads those source chunks by id (the adapter's `getById`) and compares each chunk's **current** `contentHash` against the hash stored in the cache entry.
- If any source chunk has changed (different hash) or no longer exists, the entry is **invalidated** and the full retrieve → rerank → generate pipeline re-runs against the fresh content.

Because re-ingest rewrites the chunk's `contentHash`, any cached answer grounded on that chunk fails its next grounding check and is regenerated automatically. The guarantee: **a cache hit can never serve an answer grounded on content that has since changed.** (This is independent of `CACHE_TTL_SECONDS`, which only bounds how long entries live — grounding is checked on every hit regardless of TTL.)

### Knowledge-gap detection (weekly)

`scripts/knowledge-health.ts` scans the audit-event dump for low-confidence (fallback) queries — the questions users are asking that your content **cannot answer** — and emits a prioritised gap report grouped by repeated topic. Run it weekly.

```bash
# Weekly — writes ./reports/knowledge-gaps-YYYY-MM-DD.md
npm run knowledge-health -- --days 7 --output ./reports

# Scope to one namespace, or tune the gap threshold (defaults to MIN_RETRIEVAL_CONFIDENCE)
npm run knowledge-health -- --days 7 --namespace public-policy --threshold 0.7 --output ./reports
```

The report's "top gap topics" table is your content backlog: each row is a cluster of low-confidence queries the bot keeps fielding. Fill those gaps by adding/expanding source docs and re-ingesting the relevant namespace. (Reads `./logs/audit.ndjson` by default — see [Where the signals come from](#where-the-signals-come-from).)

### Coverage-review cadence by deployment type

Gap detection catches what users ask; a periodic **full coverage review** catches what they *don't* ask but should be able to. Recommended cadence:

| Deployment type | Full coverage review | Trigger-based re-ingest |
|---|---|---|
| Regulatory / policy-heavy | Monthly | On every policy or regulation update |
| Internal HR / IT helpdesk | Quarterly | On every handbook or runbook revision |
| Public-facing constituent service | Bi-monthly | On every published web-content update |
| Product / support assistant (SaaS) | Quarterly | On every docs release / changelog |
| Dev / prototype | As needed | When source docs change |

---

## 2. Model and dependency maintenance

### Test a new LLM before switching

When your provider ships a new model version, **do not flip `LLM_MODEL` in production first**. A model that wins on general benchmarks is not necessarily better on *your* domain. Run the new model against your eval suite (`npm run test`, plus your domain Q/A eval set) and compare faithfulness, citation accuracy, and answer quality before promoting it.

### Cache auto-clears on model change

`CACHE_INVALIDATE_ON_MODEL_CHANGE=true` auto-clears the response cache when `LLM_MODEL` changes, so answers generated by the old model are never served under the new one. Keep this enabled. (Note this is distinct from the per-hit grounding check in §1 — that handles *content* changes; this handles *model* changes.)

### Embedding model changes require a full re-embed

Changing `EMBEDDING_MODEL` is far more disruptive than changing the LLM. A different embedding model produces **different vectors**, so the existing vectors in the store are no longer comparable to freshly embedded queries — retrieval quality collapses. There is no incremental path: **every document must be re-embedded and re-ingested from scratch**, across all namespaces.

- Treat this as a planned **maintenance window**, not a config tweak.
- Re-ingest every namespace (loop over your sources with `npm run ingest -- --namespace …`); budget hours for large knowledge bases.
- Do not change `EMBEDDING_MODEL` and `LLM_MODEL` in the same change — isolate the variables so you can attribute any quality shift.

### Pin dependencies, review monthly

The vector store SDKs and LLM provider SDKs all ship breaking changes. **Pin versions in `package.json`** and review upgrades on a monthly cadence rather than accepting automatic upgrades in production. Run `npm run typecheck`, `npm run lint`, and `npm run test` after any dependency bump before it reaches prod.

---

## 3. Accuracy monitoring

Answer quality degrades **silently**. If you are not measuring it, you will not notice until a user complains. Watch these four signals **weekly**:

| Signal | What it is | What a bad trend means |
|---|---|---|
| **Retrieval-confidence trend** | Average top-chunk similarity across queries | A decline means the KB is drifting from what users ask — new topics the docs don't cover |
| **Escalation rate** | % of queries hitting the low-confidence fallback (flagged for human review) | A spike = a sudden KB gap *or* a prompt-injection attempt; a slow climb = coverage drift |
| **Negative-feedback rate** | Thumbs-down from users (stored with full retrieval context so you can debug *why* the answer was wrong) | Rising = answers are wrong even when confidence looks fine; pull the stored context and inspect |
| **Cache hit rate** | % of queries served from the response cache | A drop after a stable period = user question patterns are shifting (KB-planning signal) |

### Where the signals come from

All four are derived from the **audit events** the audit logger emits (`event_type` of `query`, `cache`, `security`, `ingest`). Analyse them with the reporting CLIs against an **audit dump** (newline-delimited JSON):

```bash
# Produce a dump. Dev: tee console audit output. Prod: export the window from your SIEM
#   (CloudWatch / S3 / Splunk per AUDIT_LOG_TARGET) to ./logs/audit.ndjson
AUDIT_LOG_TARGET=console npm run dev > logs/audit.ndjson

# Weekly accuracy + KB-gap snapshot (escalation rate, cache hit rate, gap topics)
npm run knowledge-health -- --days 7 --output ./reports

# Broader audit summary over a date range (query volume, cache performance,
# security events, NIST 800-53 continuous-monitoring evidence)
npm run audit-report -- --from 2026-06-01 --to 2026-06-14 --output ./reports
```

Both CLIs default to reading `./logs/audit.ndjson`; override with `--input`. Set up a **weekly review** of these metrics. For federal deployments, document and retain this review as continuous-monitoring evidence under the ATO.

---

## 4. Security maintenance

The ability to write to the knowledge base is a privileged operation: poisoning the KB with false information is a **write-to-prod-database-level risk**. Treat it accordingly.

### Dependency vulnerability scanning — every PR

Run `npm audit` in CI **on every pull request**; fail the build on high/critical advisories. **Federal** adds agency-approved **SAST/DAST** tooling on top of `npm audit`.

### Prompt-injection monitoring — weekly

The pipeline flags suspected injection attempts as **security audit events** (`event_type: "security"`) — instruction-like text in user queries, attempts to override the system persona, queries that reference the system prompt by name. **Review these weekly.** Surface them quickly with the audit report:

```bash
npm run audit-report -- --from 2026-06-07 --to 2026-06-14 --output ./reports
# → see the "Security events" section, broken down by category
```

A spike in the escalation rate (§3) can also be the first sign of an injection campaign — cross-check the two.

### Access review — quarterly

Every quarter, review **who can ingest**. Anyone who can run `npm run ingest` (or call `/api/ingest`) can alter what the bot tells every user. Confirm the list of people and service roles with ingest access is still correct and minimal; revoke anyone who no longer needs it. Treat ingest access like write access to a production database.

### FedRAMP continuous monitoring (federal only)

FedRAMP authorization is not a one-time event. It requires:

- **Monthly** vulnerability scans
- **Annual** penetration test
- Ongoing **POA&M** (Plan of Action and Milestones) tracking for every identified weakness

`/federal/compliance/controls-matrix.md` maps which NIST 800-53 controls require continuous evidence collection. The `npm run audit-report` output includes a NIST 800-53 (AU-2, AU-6, AU-12) continuous-monitoring evidence summary you can retain as part of that evidence — records carry hashes only (never raw query/response text when `LOG_QUERY_HASHES=true`), retained per `AUDIT_LOG_RETENTION_DAYS` (1095 / 3 years in the federal example).

---

## 5. 508 / accessibility maintenance (federal)

Accessibility compliance is **not a one-time audit** — it degrades as the UI evolves. Every UI change must be re-tested against WCAG 2.1 AA before it ships. The recommended, layered process:

| Layer | Cadence | What |
|---|---|---|
| Automated scan | **Per PR** | `axe-core` (or equivalent) integrated into CI; block the merge on new violations |
| Manual keyboard test | **Per release** | Full keyboard-only walkthrough — send a message, read citations, trigger feedback; verify logical tab order and that focus is never trapped |
| Screen-reader test | **Monthly** | NVDA + Chrome and VoiceOver + Safari; confirm `role="log"` / `aria-live="polite"` announcements and the `STREAM_BUFFER_MS` sentence buffering still work |
| VPAT review | **On UI change** | Re-review `/federal/compliance/VPAT.md` any time a new UI component is added or a core interaction changes; most procurements require a current VPAT |

---

## 6. Suggested maintenance schedule

| Frequency | Tasks |
|---|---|
| **On every doc update** | Re-ingest the changed namespace (`npm run ingest -- --namespace …`); the cache re-grounds automatically via the content-hash check — no manual clear |
| **Weekly** | `npm run knowledge-health -- --days 7 --output ./reports`; review the four accuracy signals (retrieval confidence, escalation rate, negative feedback, cache hit rate); review prompt-injection security events (`npm run audit-report`) |
| **Monthly** | Dependency review + bump (pinned, then `typecheck`/`lint`/`test`); 508 automated-scan health check; FedRAMP vulnerability scan (federal) |
| **Quarterly** | Full knowledge-base coverage review (per the §1 cadence table); ingest-access review; embedding-model evaluation; monthly screen-reader test rolled up (federal) |
| **Annually** | Full security assessment; VPAT review and re-publication (federal); ATO renewal prep, annual pentest (federal) |
| **On model change** | Run the eval suite against the new LLM **before** switching; keep `CACHE_INVALIDATE_ON_MODEL_CHANGE=true`; if `EMBEDDING_MODEL` changes, schedule a maintenance window and **full re-embed / re-ingest of all namespaces** |

---

*Cross-references: [`README.md`](./README.md) (overview + getting started), [`CONFIG.md`](./CONFIG.md) (every env var explained), [`federal/FEDERAL.md`](./federal/FEDERAL.md) and [`federal/compliance/`](./federal/compliance/) (FedRAMP + 508 detail).*
