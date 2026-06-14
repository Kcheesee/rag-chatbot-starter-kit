# Incident Response Runbook

> **Scope.** Incident response procedures for the RAG Chat Agent operating in **federal mode**
> (`DEPLOYMENT_MODE=federal`) inside the FedRAMP authorization boundary. This runbook follows the
> NIST SP 800-61 incident-handling lifecycle — **Detection → Triage → Containment → Eradication →
> Recovery → Post-incident** — and provides a dedicated playbook for each incident class this
> system faces.
>
> **This is a template, not an approved plan.** It must be tailored to your agency's System
> Security Plan (SSP), reviewed by the ISSO, and incorporated into (or referenced by) the agency's
> formal IR plan before an Authority to Operate (ATO). It does not replace the agency IR plan — it
> implements the system-specific portion of it.

---

## How this system makes incidents detectable

This runbook leans on facilities already built into the codebase. Familiarity with them is a
prerequisite for any responder.

| Facility | What it is | Where |
|---|---|---|
| **Audit logger** | Structured, NIST 800-53 (AU-2/AU-3/AU-12) event emitter. Events carry **metadata and scores only — never raw query or response text.** | `packages/audit-logger` |
| `AUDIT_LOG_TARGET` | Where audit records land: `console \| cloudwatch \| s3 \| splunk`. Federal default is `cloudwatch` (see `/federal/.env.federal.example`). | env |
| **Security events** | `SecurityEvent.category` is one of `prompt_injection_suspected`, `auth_failure`, `rate_limit_exceeded`, `unauthorized_namespace`, `knowledge_poisoning_suspected`. | `packages/audit-logger/src/types.ts` |
| **Query / Ingest / Cache events** | `QueryEvent` (confidence, escalation, cache, model, faithfulness), `IngestEvent` (files/chunks/tokens/errors, `pii_redacted`), `CacheEvent` (`hit \| miss \| grounding_failed \| store \| invalidate`). | same |
| `npm run audit-report` | CLI that generates an audit-log report for a date range (`scripts/audit-report.ts`). The primary evidence-pull tool. | scripts |
| **Cache grounding re-validation** | On every cache hit the pipeline re-checks the cached answer's source content hashes against the live store; a mismatch emits `cache.grounding_failed` and invalidates the entry. This is the mechanism that auto-detects and self-heals stale/poisoned content after a clean re-ingest. | `packages/rag-core/src/cache/grounding.ts`, `pipeline.ts` stage 5/13 |
| **Input sanitisation** | First pipeline stage; flags injection-like queries and emits `prompt_injection_suspected`. Defence-in-depth, not the primary control — the locked, server-assembled system prompt is. | `packages/rag-core/src/sanitize.ts` |
| `/api/health` | Liveness/readiness endpoint reporting dependency status (LLM, vector store, cache, session store). | `apps/web` API layer |
| **Disable switches** | `INGEST_ENABLED=false` (or revoke the ingest IAM role) halts knowledge-base writes; `AUTH_ENABLED` / SAML IdP controls gate chat access; `CACHE_ENABLED=false` forces fresh retrieval. | env / IAM |

> **Logging hygiene that helps responders.** With `LOG_QUERY_HASHES=true` (federal default), queries
> are logged as `sha256(query)` — you can correlate repeated identical malicious queries across
> sessions without ever exposing the text. `LOG_RESPONSES=false` keeps PII out of the logs. Audit
> retention is `AUDIT_LOG_RETENTION_DAYS=1095` (3 years) in federal mode.

---

## Roles and contacts

> Replace placeholders before activation. Keep this table current — stale contacts are the most
> common cause of a blown response-time SLA.

| Role | Responsibility | Name / Contact (placeholder) |
|---|---|---|
| Incident Commander (IC) | Owns the incident end-to-end; declares severity; authorizes containment | `<NAME>` — `<phone>` / `<email>` |
| System Owner | Business decisions, service-down authorization | `<NAME>` — `<email>` |
| ISSO (Information System Security Officer) | Compliance, evidence custody, agency/FedRAMP reporting | `<NAME>` — `<email>` |
| ISSM / Authorizing Official rep | ATO impact decisions | `<NAME>` — `<email>` |
| Engineering on-call | Executes containment/eradication in infra | `<rotation>` — `<pager>` |
| Knowledge-base owner(s) | Validates/re-ingests clean sources (poisoning incidents) | `<NAME(s)>` — `<email>` |
| Cloud / GovCloud admin | IAM, network, ElastiCache/Aurora/Bedrock controls | `<NAME>` — `<email>` |
| Privacy / Legal | Breach determination, notification obligations | `<NAME>` — `<email>` |
| Agency SOC / CSIRT | Receives reports, coordinates US-CERT/CISA | `<24x7 line>` |
| Public Affairs | External communications (if authorized) | `<NAME>` |

---

## Severity definitions

| Severity | Definition | Examples | Target initial response |
|---|---|---|---|
| **SEV-1 / Critical** | Confirmed unauthorized exposure of CUI/sensitive data, active breach, or full outage of a production federal system | Data breach, credential compromise with data access, total `/api/health` failure | Immediate — page IC + ISSO; begin reporting clock |
| **SEV-2 / High** | Credible attack in progress or partial loss of confidentiality/integrity/availability | Sustained prompt-injection campaign, suspected KB poisoning, auth-failure spike indicating brute force, single critical dependency down | < 1 hour |
| **SEV-3 / Moderate** | Contained or low-impact security event; degraded but functioning service | Isolated injection attempts (sanitiser working), transient dependency flapping, elevated escalation rate | < 4 hours |
| **SEV-4 / Low** | Informational; no confidentiality/integrity/availability impact | Single benign auth failure, noise-level rate-limit trips | Next business day |

---

## FedRAMP / reporting obligations

Federal incidents are **not** discretionary to report. Every confirmed or suspected incident in this
boundary must be handled per the agency's IR plan and reported on the timelines below. The on-system
audit trail (`npm run audit-report`, raw records in `AUDIT_LOG_TARGET`) is the authoritative evidence
source for these reports.

- **US-CERT / CISA reporting.** Report incidents to CISA per the agency's procedures and the US-CERT
  Federal Incident Notification Guidelines. Establish the attack-vector category and the functional/
  informational impact, and meet the agency's notification window — **report within 1 hour of
  declaration** for major incidents (and follow any tighter agency SLA). Do not wait for full root
  cause to file the initial notification.
- **FedRAMP / PMO + AO/ISSO.** Notify the Authorizing Official, ISSO, and (for FedRAMP-authorized
  systems) the FedRAMP PMO and the relevant 3PAO/agency reps per the continuous-monitoring and IR
  requirements. PII incidents trigger additional agency privacy-office and breach-notification rules.
- **Recordkeeping.** Retain all incident evidence for the audit retention period
  (`AUDIT_LOG_RETENTION_DAYS`, federal default 1095 days) and feed lessons learned into the POA&M.

---

# Playbook 1 — Data breach / unauthorized data exposure

Unauthorized disclosure of CUI, PII, knowledge-base content beyond a user's authorized namespace, or
leakage of system internals (e.g. the system prompt).

### Detection signals
- Security events: `unauthorized_namespace` (a principal retrieved/attempted a namespace they are not
  authorized for), clusters of `prompt_injection_suspected` whose intent is exfiltration (`reveal /
  show / repeat the system prompt`).
- `QueryEvent` anomalies via `npm run audit-report`: unexpected `namespace` values for a `user_id`,
  abnormal `source_count`, queries from one principal spanning many namespaces.
- External signal: data appearing where it should not (another tenant, public surface, SIEM DLP
  alert), GovCloud CloudTrail showing access to Aurora pgvector / S3 / ElastiCache outside expected
  roles.

### Triage
- Determine **what data, whose data, and classification** (`DATA_CLASSIFICATION`, `IMPACT_LEVEL`).
- Confirm exposure vs. attempt. Any confirmed CUI/PII exposure is **SEV-1** and starts the reporting
  clock immediately.

### Containment (immediate)
- Revoke the offending principal/session: disable the user in the SAML IdP; if systemic, set
  `AUTH_ENABLED=true` is already on — tighten by suspending the affected role or, for a live breach,
  take chat offline (scale to zero / maintenance page).
- Lock down the data store: rotate/restrict IAM roles on Aurora pgvector, ElastiCache, and any S3
  audit/export buckets; block the source IP at the boundary.
- Preserve state before changing it (snapshots, log export) — see Evidence.

### Eradication
- Close the access path: fix namespace-authorization/RBAC defect, rotate exposed credentials, remove
  any misconfiguration that widened the boundary.
- If the system prompt or internals leaked, confirm no secrets were embedded (there should be none —
  credentials are IAM-assumed, never in env at High impact level).

### Recovery
- Restore service with corrected access controls; verify via targeted queries that namespace
  isolation holds (a user cannot retrieve another namespace).
- Increase monitoring sensitivity on `unauthorized_namespace` for a defined watch period.

### Evidence to capture
- `npm run audit-report` export covering the window (query + security events).
- Raw audit records from `AUDIT_LOG_TARGET`, GovCloud CloudTrail, VPC/access logs, data-store audit
  logs, IdP logs. Record affected `user_id`/`session_id`, `namespace`, timestamps, data scope, and
  classification. Hand custody to the ISSO.

---

# Playbook 2 — Prompt-injection attack

Attempts to override the locked system prompt, exfiltrate it, or jailbreak the model (`ignore previous
instructions`, `reveal the system prompt`, `you are now…`, `DAN`/`jailbreak`).

### Detection signals
- **Primary:** `security` events with `category: "prompt_injection_suspected"`, emitted by the
  pipeline (`sanitizeInput` → `pipeline.ts` stage 1) whenever a query matches an `INJECTION_PATTERNS`
  rule. Each event carries a PII-free `detail` (`"Query matched a prompt-injection pattern."`),
  `session_id`, optional `user_id`/`principal`, and timestamp.
- **Audit-log review** is the core workflow here: `npm run audit-report` over the window, filter
  `event_type=security, category=prompt_injection_suspected`. With `LOG_QUERY_HASHES=true`, correlate
  repeated identical attempts by `query_hash` across sessions to distinguish a probe from a campaign.
- Secondary: spikes in `QueryEvent.escalated` (injection often forces the low-confidence fallback);
  rising rate-limit events from the same principal.

### Triage
- Volume + sophistication. A handful of blocked attempts (sanitiser stripped the line, no behavioral
  change) is **SEV-3/4**. A sustained, varied campaign or any sign the model actually deviated is
  **SEV-2**.
- Confirm the layered defence held: the system prompt is server-assembled and the hard rules sit
  between persona and untrusted context, so a flagged query does **not** imply compromise.

### Containment (immediate)
- Rate-limit / block the offending `principal` (`AUTH_RATE_LIMIT`, boundary IP block).
- For an authenticated abuser, suspend the account in the IdP.
- If a novel pattern is bypassing the sanitiser, raise `INJECTION_PATTERNS` coverage and, as a stopgap,
  lower `MAX_TOKENS` / tighten the persona; consider `FAITHFULNESS_CHECK=true` so off-context
  generations escalate instead of returning.

### Eradication
- Add the new bypass pattern(s) to `packages/rag-core/src/sanitize.ts`; add a regression test.
- Verify the system prompt remains non-user-modifiable and no tool/secret is reachable from a query.

### Recovery
- Deploy the updated sanitiser; confirm new attempts are flagged and stripped.
- Monitor `prompt_injection_suspected` rate back to baseline.

### Evidence to capture
- Security-event export (categories, counts, `query_hash`es, principals, timestamps) from
  `npm run audit-report`. Note: raw injecting text is intentionally **not** stored — record the hash
  and the matched-pattern `detail`. Capture the sanitiser version/diff applied.

---

# Playbook 3 — Unauthorized access (auth failures, IA controls)

Failed or illegitimate authentication/authorization against the chat or ingest surfaces — brute force,
credential stuffing, session abuse, privilege escalation (NIST 800-53 **IA** / **AC** controls).

### Detection signals
- Security events: `auth_failure` (failed authentication), `rate_limit_exceeded`,
  `unauthorized_namespace` (authorized session reaching for a forbidden namespace).
- Pattern via `npm run audit-report`: bursts of `auth_failure` from one `principal`/IP, distributed
  low-and-slow failures across many accounts, off-hours access, failures immediately preceding a
  successful login.
- SAML IdP logs and GovCloud CloudTrail for the corresponding auth/role-assumption activity.

### Triage
- Distinguish a fat-fingered single failure (**SEV-4**) from a brute-force/stuffing campaign or a
  confirmed unauthorized success (**SEV-2/1**). A successful unauthorized access that touched data is
  a **data breach — escalate to Playbook 1.**

### Containment (immediate)
- Lock the targeted account(s) in the SAML IdP; block source IP(s) at the boundary; tighten
  `AUTH_RATE_LIMIT`.
- For a credible active campaign, you can hard-stop the surface: ensure `AUTH_ENABLED=true`, or take
  chat offline until controls are reinforced.
- Force re-authentication / session invalidation; rotate any potentially compromised IdP secrets.

### Eradication
- Fix the weakness: enforce MFA/PIV-CAC, correct misconfigured RBAC/namespace mappings, patch the
  auth middleware defect.
- Confirm least-privilege on IAM roles (chat role cannot write to the vector store; ingest is a
  separate, privileged role — see Playbook 4).

### Recovery
- Restore normal access; verify legitimate users authenticate and that namespace authorization is
  enforced.
- Heighten alerting on `auth_failure` / `unauthorized_namespace` for a watch period.

### Evidence to capture
- `auth_failure` / `rate_limit_exceeded` / `unauthorized_namespace` export from
  `npm run audit-report`, IdP authentication logs, CloudTrail, boundary/WAF logs. Record principals,
  IPs, timestamps, success-vs-failure, and any data reached.

---

# Playbook 4 — Knowledge-base poisoning

Someone with **ingest access** adds false or malicious content to the vector store. Ingest is a
**privileged, audited operation** — treat ingest access like write access to a production database
(per the README access-review guidance).

### Detection signals
- **`IngestEvent`s** via `npm run audit-report` (`event_type=ingest`): an ingest run with no
  authorized change ticket, an unexpected `user_id`/principal, an unfamiliar `source_type`, anomalous
  `files_processed` / `chunks_created` / `tokens_processed`, elevated `errors`, or
  `pii_redacted=false` where redaction was expected.
- Security event `knowledge_poisoning_suspected` (where wired to fire on suspicious ingest).
- Downstream symptoms: spike in negative feedback, answers citing content that contradicts the source
  of record, escalation-rate anomalies.

### Triage
- Identify **which namespace(s) and which ingest run(s)** are suspect (correlate `IngestEvent`
  timestamps with the change calendar). Suspected poisoning of a CUI/decision-support namespace is
  **SEV-2** (integrity).

### Containment (immediate)
- **Stop the bleeding:** disable ingest — `INGEST_ENABLED=false` and/or revoke the ingest IAM role so
  no further writes are possible.
- Quarantine the affected namespace (route queries away or take it offline) so poisoned chunks are not
  served while you investigate.

### Eradication
- Remove the malicious content: purge the affected namespace/chunks, then **re-ingest from clean,
  authoritative sources** validated by the knowledge-base owner (`npm run ingest -- --namespace <ns>`
  rebuilds a single namespace without touching the rest).
- **Cache grounding re-validates automatically.** Cached answers store the `contentHash` of each
  source chunk. On the next hit the pipeline re-checks those hashes against the live store; any answer
  grounded in now-removed/changed (poisoned) content fails grounding, emits `cache.grounding_failed`,
  and is invalidated — so stale poisoned answers self-purge after the clean re-ingest. You may also
  force-clear with `CACHE_ENABLED=false` (restart) or an explicit cache invalidation.

### Recovery
- Re-enable ingest only after restoring least-privilege and tightening approvals; restore the
  namespace to live traffic.
- Spot-check answers in the affected namespace against the source of record; confirm `cache` events
  show fresh `store`s grounded on the clean content.

### Evidence to capture
- Full `IngestEvent` history for the namespace (`npm run audit-report`): who, when, source type,
  counts, errors. The pre- and post-remediation source manifest/hashes, the malicious content sample,
  and `cache.grounding_failed`/`invalidate` events proving the stale entries were purged.

---

# Playbook 5 — Service outage / availability

Loss or degradation of the chat service, whether the app itself or a backing dependency: LLM
(Bedrock GovCloud / Azure Gov / internal), vector store (Aurora pgvector), response cache /
session store (ElastiCache).

### Detection signals
- **`/api/health`** failing or reporting a degraded dependency (LLM, vector store, cache, session
  store) — the primary liveness/readiness signal; wire it to GovCloud monitoring/alerting.
- Audit/metrics: surge in pipeline `error` chunks, latency blowout (`latency_ms` in `QueryEvent` /
  `CacheEvent`), retrieval/generation failures; cloud-provider service-health alerts.
- User reports of timeouts or errors.

### Triage
- Isolate the failing layer from `/api/health` and dependency dashboards: app vs. LLM vs. vector
  store vs. cache/session. Full production outage = **SEV-1**; single non-fatal dependency degraded =
  **SEV-2/3**. Confirm it is availability-only, not a security event presenting as an outage (e.g. a
  volumetric attack — if so, cross-link Playbook 3).

### Containment (immediate)
- Stabilize: fail over to a healthy region (`ALLOWED_REGIONS`), scale out the API, or post a
  maintenance page.
- Per-dependency mitigations:
  - **LLM down** — fail over to the secondary GovCloud model/region; the confidence gate already
    returns a no-LLM fallback for unservable queries.
  - **Vector store down** — restore the Aurora pgvector replica/endpoint; queries will hit the
    low-confidence fallback meanwhile.
  - **Cache/session down** — set `CACHE_ENABLED=false` to bypass the cache and serve fresh retrieval;
    sessions degrade to stateless until ElastiCache is restored.

### Eradication
- Fix root cause: correct the misconfig/quota/IAM/network issue, patch the regression, or follow the
  cloud provider's remediation for a platform outage.

### Recovery
- Bring dependencies back; confirm `/api/health` reports all green and `latency_ms` returns to
  baseline. Re-enable cache (`CACHE_ENABLED=true`) once the store is healthy — grounding re-validation
  protects correctness on the first hits.
- Run a few canary queries end-to-end before lifting the maintenance page.

### Evidence to capture
- `/api/health` history, monitoring/alert timeline, audit error rate and `latency_ms` from
  `npm run audit-report`, cloud-provider status/health-event records, and the config/infra change that
  resolved it. Record start/detect/restore times for the after-action availability metric.

---

## Post-incident (all playbooks)

Required for every declared incident, per NIST 800-61 "post-incident activity":

1. **Lessons-learned review** within the agency's SLA (e.g. 5 business days). Build a timeline:
   detect → contain → eradicate → recover.
2. **Root-cause analysis** documented and signed by the IC and ISSO.
3. **POA&M.** File or update Plan of Action and Milestones entries for any control weakness; track to
   closure under continuous monitoring (`/federal/compliance/controls-matrix.md`).
4. **Control / detection improvements.** Update `INJECTION_PATTERNS`, RBAC/namespace mappings,
   alert thresholds, `/api/health` checks, or ingest approvals as indicated.
5. **Final reporting.** Submit the closing report to CISA/US-CERT and the FedRAMP PMO/AO per the
   reporting obligations above; confirm evidence is retained for `AUDIT_LOG_RETENTION_DAYS`.
6. **Runbook update.** Fold what you learned back into this document and re-validate contacts.
