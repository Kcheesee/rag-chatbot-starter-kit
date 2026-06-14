# System Security Plan (SSP) — Template

> **This is a template, not an authorization.** It is pre-populated for the
> `rag-chat-agent` Federal tier (Tier 3) architecture to save an agency weeks of
> preparation, but it does **not** constitute an Authority to Operate (ATO). Every
> section marked **[agency to complete]** requires agency-specific information and
> evidence. An ATO requires an independent assessor (3PAO or agency-designated
> assessment team) and formal sign-off by the agency Authorizing Official (AO) and
> Information System Security Officer (ISSO). Templates accelerate the process; they
> do not replace it.
>
> **Style basis:** FedRAMP System Security Plan / NIST SP 800-53 Rev 5 control
> structure. Tailor the baseline (Low / Moderate / High) to the categorization you
> record in §2 before submission.

---

## Document control

| Field | Value |
|---|---|
| System name | **[agency to complete]** (e.g. "Agency Knowledge Assistant") |
| System acronym | **[agency to complete]** |
| Service model | SaaS / PaaS hybrid — application deployed by the agency onto an authorized cloud boundary (AWS GovCloud or Azure Government) |
| SSP version | 0.1 (template) |
| SSP date | **[agency to complete]** |
| System owner | **[agency to complete]** |
| Authorizing Official (AO) | **[agency to complete]** |
| ISSO / ISSM | **[agency to complete]** |
| Independent assessor (3PAO) | **[agency to complete]** |

---

## 1. System identification

| Attribute | Value |
|---|---|
| Application | `rag-chat-agent` — Retrieval-Augmented Generation chat assistant |
| Deployment tier | Tier 3 (Federal / PubSec) — `DEPLOYMENT_MODE=federal` |
| Source repository | `rag-chat-agent` monorepo, `/federal` tier |
| Hosting boundary | AWS GovCloud (us-gov-west-1 / us-gov-east-1) **or** Azure Government |
| Underlying authorized service | AWS GovCloud FedRAMP package **or** Azure Government FedRAMP package **[agency to confirm and cite package ID]** |
| Application version | See `APP_VERSION` (currently `0.1.0`) |

The application is a model-agnostic RAG chatbot. In the Federal tier it routes all
LLM and embedding calls through an authorized GovCloud boundary, stores vectors and
sessions inside that boundary, authenticates users via agency SAML 2.0 (PIV/CAC),
redacts PII, and emits NIST-shaped structured audit events.

---

## 2. System categorization (FIPS 199 / FIPS 200)

Categorize the system per **FIPS 199** and confirm the security control baseline per
**FIPS 200 / NIST SP 800-53 Rev 5**. The application exposes the categorization it was
configured for via the `IMPACT_LEVEL` environment variable.

| Security objective | Provisional impact | Rationale (template — **[agency to confirm]**) |
|---|---|---|
| Confidentiality | **[agency to complete]** | Driven by `DATA_CLASSIFICATION`. If CUI is ingested, confidentiality is at least Moderate. |
| Integrity | **[agency to complete]** | Wrong answers from a stale or poisoned knowledge base carry agency mission risk. |
| Availability | **[agency to complete]** | Set per the criticality of the constituent/internal service the bot supports. |

**Overall categorization (high-water mark):** **[agency to complete]**

`IMPACT_LEVEL` mapping (set in `federal/.env.federal.example`):

- `IMPACT_LEVEL=low` — public-facing informational tools, no PII or sensitive data.
- `IMPACT_LEVEL=moderate` — most civilian agency internal tools; aligns with OpenAI via Azure Government (FedRAMP Moderate).
- `IMPACT_LEVEL=high` — systems handling CUI, law enforcement, or health data; requires Claude via AWS Bedrock GovCloud (FedRAMP High).

> The env schema **rejects** a federal configuration unless `LLM_PROVIDER ∈
> {bedrock-gov, azure-gov, internal}`, the region is a GovCloud region for
> `bedrock-gov`, `VECTOR_STORE != pinecone`, `PGVECTOR_SSL=require`, and
> `AUTH_ENABLED=true`. These invariants enforce the categorization-driven posture at
> startup.

---

## 3. Authorization boundary

The authorization boundary comprises every component that stores, processes, or
transmits agency data, all running inside the authorized GovCloud / Azure Government
region set (`ALLOWED_REGIONS`, enforced when `ENFORCE_DATA_RESIDENCY=true`).

**Inside the boundary:**

- Next.js application (API route handlers + WCAG/508 UI) on AWS GovCloud ECS or Azure Government App Service.
- LLM inference: AWS Bedrock GovCloud (Claude) **or** Azure Government OpenAI, **or** an agency-internal model endpoint (`LLM_PROVIDER=internal`, mTLS/PKI).
- Embeddings: generated inside the boundary (e.g. `EMBEDDING_PROVIDER=bedrock`, `amazon.titan-embed-text-v2:0`).
- Vector store: pgvector on AWS Aurora GovCloud (`PGVECTOR_*`, TLS required).
- Session store: AWS ElastiCache GovCloud.
- PII redaction: AWS Comprehend (GovCloud) via `PII_REDACTION_PROVIDER=aws-comprehend`.
- Audit logging sink: Amazon CloudWatch (GovCloud) via `AUDIT_LOG_TARGET=cloudwatch`.
- Secrets/credentials: IAM role / instance profile / Managed Identity — **no static API keys**.

**Outside the boundary (interconnections — document each in §6):**

- Agency Identity Provider (SAML 2.0 IdP, `SAML_ENTRY_POINT`) for PIV/CAC authentication. **[agency to complete: IdP details, SAML metadata]**
- Agency-approved SIEM, if audit records are forwarded beyond CloudWatch. **[agency to complete]**
- Ingestion source systems (document repositories the agency loads into the knowledge base). **[agency to complete]**

> A network/data-flow boundary diagram is required for the SSP. Generate it from the
> `/federal/infra/terraform-govcloud` (AWS) or `/federal/infra/azure-gov` (Azure) IaC
> and attach as an appendix. **[agency to complete]**

---

## 4. System description and architecture

```
                 Agency user (PIV / CAC)
                          │  TLS 1.2+
                          ▼
        ┌───────────────────────────────────────────┐
        │  SAML 2.0 SSO (agency IdP, outside boundary)│
        └───────────────────────────────────────────┘
                          │  authenticated session
                          ▼
  ┌───────────────────── Authorization boundary (GovCloud / Azure Gov) ─────────────────────┐
  │                                                                                          │
  │   Next.js API + WCAG 2.1 AA / 508 UI (ECS / App Service)                                  │
  │     /api/chat   /api/ingest   /api/health   (auth middleware, rate limiting)             │
  │                          │                                                               │
  │                          ▼                                                               │
  │   RAG core:  PII redaction (Comprehend) → embed → retrieve → rerank → generate           │
  │                 │                 │                    │                                 │
  │                 ▼                 ▼                    ▼                                 │
  │   ElastiCache    pgvector on Aurora        Bedrock GovCloud (Claude)                     │
  │   (sessions)     (vectors, TLS)            or Azure Gov OpenAI (GPT)                      │
  │                                            or internal model (mTLS)                      │
  │                          │                                                               │
  │                          ▼                                                               │
  │   Audit logger → CloudWatch (NIST AU-2/AU-3/AU-12; metadata + scores, no raw text)       │
  │                                                                                          │
  └──────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Components

| Component | Implementation | Notes |
|---|---|---|
| LLM (inference) | AWS Bedrock GovCloud (Claude) or Azure Government OpenAI (GPT); `LLM_PROVIDER=internal` supported for agency-served models | Commercial `api.anthropic.com` / `api.openai.com` are out of boundary and prohibited |
| Embeddings | Generated inside the boundary (`EMBEDDING_PROVIDER=bedrock`) | No data leaves the boundary for embedding |
| Vector store | pgvector on AWS Aurora GovCloud (`VECTOR_STORE=pgvector`) | Pinecone prohibited (no FedRAMP authorization) |
| Session store | AWS ElastiCache GovCloud | Data residency — must remain CONUS / in-boundary |
| Authentication | SAML 2.0 with PIV/CAC (`AUTH_PROVIDER=saml`) | Federated to the agency IdP |
| Audit logging | `packages/audit-logger`, NIST-shaped events → CloudWatch | Structured metadata only, never raw query/response text |
| PII redaction | AWS Comprehend (`PII_REDACTION_PROVIDER=aws-comprehend`) | Runs on ingest and on the request path |
| API + UI | Next.js route handlers + WCAG 2.1 AA / Section 508 UI (`A11Y_MODE=true`) | Stream-buffered announcements (`STREAM_BUFFER_MS`) for screen readers |
| Credentials | IAM role / instance profile / Managed Identity | No static keys anywhere in the boundary |

### 4.2 Ports, protocols, and services

**[agency to complete]** — enumerate from the deployed IaC (ECS task/security groups
or Azure NSGs). At minimum: HTTPS/443 ingress to the app; TLS to Aurora (5432), to
ElastiCache, to the Bedrock/Azure OpenAI endpoint, to CloudWatch, and to the SAML IdP.

---

## 5. Data types, data flows, and data residency

### 5.1 Data types

| Data type | Where it lives | Classification driver |
|---|---|---|
| Knowledge-base documents and derived chunks/vectors | pgvector on Aurora GovCloud | `DATA_CLASSIFICATION` (e.g. `CUI`) |
| User queries | Processed in memory; **not** persisted as raw text | `LOG_QUERY_HASHES=true` stores only `sha256(query)` |
| Model responses | Returned to the user; **not** persisted by default | `LOG_RESPONSES=false` — responses may contain PII |
| Session/conversation state | ElastiCache GovCloud, bounded by `SESSION_MAX_TURNS` | In-boundary only |
| Audit records | CloudWatch GovCloud | Metadata + scores only (see `packages/audit-logger/src/types.ts`) |
| Authentication assertions | SAML, transient | Agency IdP issues; not stored long-term by the app |

**CUI handling:** When `DATA_CLASSIFICATION=CUI`, all of the above stays within the
authorized boundary, PII redaction is enabled (`PII_REDACTION_ENABLED=true`), and audit
records carry no raw content. CUI marking, dissemination controls, and handling
procedures for the source documents themselves are **[agency to complete]**.

### 5.2 Representative data flow (query path)

1. User authenticates via SAML 2.0 / PIV-CAC; an authenticated session is established (ElastiCache).
2. Query enters `/api/chat` over TLS; rate limiting and auth middleware apply.
3. PII redaction (Comprehend) runs before downstream processing.
4. Query is embedded in-boundary; pgvector returns top-K chunks; reranker refines.
5. Context + bounded history are sent to the in-boundary LLM (Bedrock GovCloud / Azure Gov / internal).
6. Response is streamed back; the 508 UI buffers announcements (`STREAM_BUFFER_MS`).
7. The audit logger emits a `QueryEvent` (hash, namespace, retrieval confidence, cache/escalation flags, source count, model) — **no raw text**.

### 5.3 Data residency

- `ALLOWED_REGIONS=us-gov-west-1,us-gov-east-1` defines the permitted regions.
- `ENFORCE_DATA_RESIDENCY=true` makes residency a startup invariant; non-GovCloud regions are rejected.
- No third-party analytics (Mixpanel/Segment) and no commercial API endpoints are in the boundary.

---

## 6. System interconnections

| Connected system | Direction | Protocol / auth | Agreement | Status |
|---|---|---|---|---|
| Agency SAML IdP | Inbound auth | SAML 2.0, PIV/CAC | ISA / MOU | **[agency to complete]** |
| Agency SIEM (optional) | Outbound logs | Agency-defined | ISA | **[agency to complete]** |
| Ingestion source repositories | Inbound docs | Agency-defined | ISA / data-use agreement | **[agency to complete]** |

A complete interconnection table with ISA/MOU references is required for the SSP.

---

## 7. Control implementation summary

The narratives below describe how **this architecture** addresses each control family.
They are starting points. Each item marked **[agency to complete]** requires agency
configuration values, organization-defined parameters (ODPs), and **evidence**
(screenshots, config exports, logs, scan results) to be assessed. Per-control
inheritance is tracked in **[controls-matrix.md](./controls-matrix.md)**.

### AC — Access Control

- **AC-2 (Account Management):** User identities are federated to the agency IdP via SAML 2.0; the application does not maintain a separate password store. Account provisioning/deprovisioning, periodic review, and disabling of inactive accounts are governed by the agency IdP. **[agency to complete: account management procedures and review evidence]**
- **AC-3 (Access Enforcement):** API routes are gated by auth middleware (`AUTH_ENABLED=true`). Optional multi-tenant mode scopes vector-store namespaces per role so a user only retrieves chunks from authorized namespaces. **[agency to complete: role-to-namespace mapping]**
- **AC-6 (Least Privilege):** Runtime credentials are assumed via IAM role / instance profile / Managed Identity scoped to the minimum services required; there are no static keys. Ingestion (knowledge-base write) is treated as a privileged operation. **[agency to complete: IAM policy documents, privileged-role inventory]**
- **AC-17 (Remote Access):** All access is over TLS through the authorized boundary; administrative access patterns are **[agency to complete]**.

### AU — Audit and Accountability

- **AU-2 / AU-12 (Event Logging / Audit Record Generation):** `packages/audit-logger` emits structured events for query, ingest, cache, and security activity when `AUDIT_LOG_ENABLED=true`. The cardinal rule, encoded in `packages/audit-logger/src/types.ts`, is that events carry **metadata and scores, never raw query or response text**.
- **AU-3 (Content of Audit Records):** Each event records who/what/when/where — `timestamp`, `event_type`, `session_id`, `user_id`, `latency_ms`, `environment`, `deployment_mode` — satisfying record-content requirements without leaking the user's question.
- **AU-6 (Audit Review, Analysis, Reporting):** `scripts/audit-report.ts` generates audit reports for a date range; weekly review of security events (e.g. suspected prompt injection) is part of the maintenance cadence. **[agency to complete: who reviews, frequency, retention of review records]**
- **AU-9 (Protection of Audit Information):** Records are written to CloudWatch (GovCloud); access control and tamper protection are inherited from the CloudWatch FedRAMP package plus agency IAM. **[agency to complete: CloudWatch access policy, log-group encryption settings]**
- **Retention:** `AUDIT_LOG_RETENTION_DAYS=1095` (3 years) in the federal example. **[agency to confirm against records-retention schedule]**

### IA — Identification and Authentication

- **IA-2 (Identification and Authentication, Organizational Users):** SAML 2.0 with PIV/CAC provides phishing-resistant, multi-factor identification of agency users. **[agency to complete: IdP assurance level, AAL mapping]**
- **IA-5 (Authenticator Management):** Authenticators (PIV/CAC certificates) are managed by the agency PKI/IdP; the application stores no passwords. **[agency to complete]**
- **IA-8 (Identification and Authentication, Non-Organizational Users):** **[agency to complete — typically N/A for internal tools; document if any non-org users exist]**

### SC — System and Communications Protection

- **SC-7 (Boundary Protection):** The system runs entirely inside the authorized GovCloud / Azure Government boundary; commercial LLM endpoints and third-party analytics are excluded by design and by the env-schema invariants. **[agency to complete: security-group/NSG and WAF configuration]**
- **SC-8 (Transmission Confidentiality and Integrity):** TLS is used everywhere, including to the vector store (`PGVECTOR_SSL=require`), the LLM endpoint, the session store, and CloudWatch. The internal model path uses mTLS (`INTERNAL_LLM_CERT_PATH` / `INTERNAL_LLM_KEY_PATH`).
- **SC-12 / SC-13 (Key Establishment & Management / Cryptographic Protection):** Cryptographic modules and key management are inherited from the cloud provider (FIPS 140-validated services in GovCloud). **[agency to complete: KMS key policies, FIPS endpoint confirmation]**
- **SC-28 (Protection of Information at Rest):** Knowledge-base data, vectors, and sessions reside in GovCloud at-rest-encrypted services (Aurora, ElastiCache); audit data at rest in CloudWatch. **[agency to complete: confirm encryption + KMS keys per data store]**

### SI — System and Information Integrity

- **SI-4 (System Monitoring):** The audit logger emits `SecurityEvent`s for `prompt_injection_suspected`, `auth_failure`, `rate_limit_exceeded`, `unauthorized_namespace`, and `knowledge_poisoning_suspected`. These feed monitoring and the IR runbook. **[agency to complete: SIEM integration, alerting thresholds]**
- **SI-10 (Information Input Validation):** The server-controlled system prompt is not user-modifiable; user input is sanitized before concatenation (prompt-injection hardening). Input validation on the env schema enforces the federal invariants at startup.
- **SI-12 (Information Management and Retention):** Raw queries and responses are not retained (`LOG_RESPONSES=false`; only `sha256` hashes when `LOG_QUERY_HASHES=true`); session memory is bounded. **[agency to complete: records-retention schedule alignment]**

### CM — Configuration Management

- **CM-2 (Baseline Configuration):** The deployed baseline is defined as code — `/federal/infra/terraform-govcloud` (AWS) or `/federal/infra/azure-gov` (Azure) plus `federal/.env.federal.example`. **[agency to complete: pinned versions, approved baseline snapshot]**
- **CM-6 (Configuration Settings):** Secure settings (federal invariants, `PGVECTOR_SSL=require`, audit/PII/SAML/residency flags) are enforced by the env schema. Dependencies are pinned in `package.json`. **[agency to complete: documented setting deviations and approvals]**

### CP — Contingency Planning

- **CP-9 (System Backup):** Backups for Aurora and ElastiCache are provided by the cloud provider's managed backup capabilities. **[agency to complete: backup schedule, retention, restore RPO/RTO]**
- **CP-10 (System Recovery and Reconstitution):** Infrastructure is reconstitutable from IaC; the knowledge base is reconstitutable via `scripts/ingest.ts`. **[agency to complete: recovery procedures, tested restore evidence]**

### IR — Incident Response

- **IR-4 (Incident Handling):** `/federal/compliance/IR-runbook.md` provides procedures for data breach, prompt injection, unauthorized access, and outage. Security events from the audit logger drive detection. **[agency to complete: roles, escalation, lessons-learned]**
- **IR-6 (Incident Reporting):** **[agency to complete: US-CERT/CISA reporting timelines, FedRAMP incident notification per agency policy]**

### RA — Risk Assessment

- **RA-5 (Vulnerability Monitoring and Scanning):** `npm audit` runs in CI on every PR; agency-approved SAST/DAST is added for federal. FedRAMP continuous monitoring requires monthly vulnerability scanning, annual penetration testing, and POA&M tracking. **[agency to complete: scan cadence, tooling, POA&M]**

---

## 8. What is inherited vs your responsibility

Controls fall into three buckets in this system:

- **Inherited** — provided by the underlying cloud provider's FedRAMP package (e.g. physical security, hypervisor, KMS crypto modules, managed-service backups). You cite the provider's package; you do not implement these.
- **Hybrid** — the cloud provider supplies the capability and **this application + the agency** configure and operate it (e.g. encryption-at-rest is provided, but you choose KMS keys and confirm it's enabled; audit logging infrastructure is provided, but the app generates the records and you review them).
- **Agency-owned** — the agency is fully responsible (e.g. account-management procedures, IdP configuration, incident-reporting timelines, records-retention decisions, the contents of the knowledge base, and all assessment/authorization activities).

See **[controls-matrix.md](./controls-matrix.md)** for the per-control breakdown,
evidence pointers, and ownership.

---

## 9. Assessment and authorization

- [ ] Categorization (§2) confirmed and baseline selected — **[agency to complete]**
- [ ] Boundary diagram attached — **[agency to complete]**
- [ ] All **[agency to complete]** narratives filled with config values and ODPs
- [ ] Evidence collected per control (configs, logs, scans, screenshots)
- [ ] Interconnection agreements (ISA/MOU) executed
- [ ] Independent assessment (3PAO / agency assessor) performed — **[required]**
- [ ] POA&M established for open items
- [ ] AO authorization decision (ATO) — **[required, not provided by this template]**

> Completing this template does **not** grant an ATO. Authorization is a decision made
> by the agency Authorizing Official after independent assessment.
