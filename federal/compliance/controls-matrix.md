# NIST 800-53 Rev 5 Controls Matrix — Inherited vs Agency-Owned

> **Template, not an authorization.** This matrix maps a representative subset of
> NIST SP 800-53 Rev 5 controls to how the `rag-chat-agent` Federal tier supports
> them and who owns each. It is pre-populated for **this** architecture to save
> preparation time. It is **not** an Authority to Operate (ATO) and does not replace
> independent assessment. Every "Evidence / Notes" cell that names an artifact still
> requires the agency to **produce and retain that evidence**, and to fill in
> organization-defined parameters. See **[SSP-template.md](./SSP-template.md)**.

## Legend

| Term | Meaning |
|---|---|
| **Inherited** | Provided by the cloud provider's FedRAMP package (AWS GovCloud / Azure Government). Cite the provider's authorized package; the agency does not implement it. |
| **Hybrid** | Cloud provider supplies the capability; **this application + the agency** configure and operate it. |
| **Agency-owned** | Agency is fully responsible — procedures, configuration decisions, evidence, and the knowledge-base contents. |

Configuration references below point at `federal/.env.federal.example`,
`packages/audit-logger/src/types.ts`, and the IaC under
`/federal/infra/terraform-govcloud` (AWS) and `/federal/infra/azure-gov` (Azure).

---

## Access Control (AC)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **AC-2** Account Management | Agency-owned (Hybrid w/ IdP) | No local password store; identities federated to the agency SAML IdP. Provisioning/deprovisioning and inactivity disabling governed by the IdP. | **[agency]** account-management SOP, periodic account-review records, IdP export. |
| **AC-3** Access Enforcement | Hybrid | Auth middleware gates API routes (`AUTH_ENABLED=true`); optional multi-tenant mode scopes vector-store namespaces per role. | **[agency]** role-to-namespace mapping; middleware config; test of denied cross-namespace retrieval. |
| **AC-6** Least Privilege | Hybrid | Runtime credentials via IAM role / instance profile / Managed Identity, scoped minimally; **no static keys**. Ingestion (KB write) treated as privileged. | **[agency]** IAM policy JSON; privileged-role inventory; proof no static keys in env/secrets. |
| **AC-17** Remote Access | Hybrid | All access over TLS through the authorized boundary; commercial endpoints excluded by env-schema invariants. | **[agency]** admin-access method, security-group/NSG rules, WAF config. |

## Audit and Accountability (AU)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **AU-2** Event Logging | Hybrid | Audit logger emits `query`, `ingest`, `cache`, `security` events when `AUDIT_LOG_ENABLED=true`. | `packages/audit-logger/src/types.ts`; **[agency]** event-selection rationale. |
| **AU-3** Content of Audit Records | Hybrid | Events carry who/what/when/where: `timestamp`, `event_type`, `session_id`, `user_id`, `latency_ms`, `environment`, `deployment_mode` — **no raw query/response text**. | `BaseAuditEvent` in `types.ts`; sample CloudWatch records. |
| **AU-6** Audit Review/Analysis/Reporting | Agency-owned | `scripts/audit-report.ts` produces date-range reports; weekly review of `SecurityEvent`s (e.g. suspected injection) per maintenance cadence. | **[agency]** reviewer role, review frequency, retained review records. |
| **AU-9** Protection of Audit Information | Hybrid (Inherited base) | Records in CloudWatch GovCloud; tamper-protection/storage inherited from the CloudWatch FedRAMP package; access controlled via agency IAM. | Provider package for CloudWatch; **[agency]** log-group IAM + KMS settings. |
| **AU-12** Audit Record Generation | Hybrid | Application generates the records at the source (fire-and-forget logger on the request path); retention `AUDIT_LOG_RETENTION_DAYS=1095` (3 yrs). | `AuditLogger` interface in `types.ts`; **[agency]** retention vs records schedule. |

## Identification and Authentication (IA)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **IA-2** I&A (Organizational Users) | Hybrid | SAML 2.0 with **PIV/CAC** (`AUTH_PROVIDER=saml`, `SAML_ENTRY_POINT`) — phishing-resistant MFA via the agency IdP. | **[agency]** IdP metadata, AAL mapping, SAML assertion sample. |
| **IA-5** Authenticator Management | Agency-owned | Authenticators (PIV/CAC certs) managed by agency PKI/IdP; application stores no passwords. | **[agency]** PKI/IdP authenticator-management policy. |
| **IA-8** I&A (Non-Organizational Users) | Agency-owned | Typically N/A for internal tools; document if any non-org users exist. | **[agency]** applicability determination. |

## System and Communications Protection (SC)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **SC-7** Boundary Protection | Hybrid | Runs entirely inside the GovCloud / Azure Gov boundary; commercial LLM endpoints + third-party analytics excluded by design and env-schema invariants. | IaC security groups/NSGs; **[agency]** WAF/boundary device config. |
| **SC-8** Transmission Confidentiality & Integrity | Hybrid | TLS everywhere — to vector store (`PGVECTOR_SSL=require`), LLM endpoint, session store, and CloudWatch; internal model path uses mTLS (`INTERNAL_LLM_CERT_PATH`/`_KEY_PATH`). | `federal/.env.federal.example`; TLS scan / endpoint policy. |
| **SC-12** Cryptographic Key Establishment & Management | Inherited (Hybrid config) | Key management via cloud KMS in GovCloud; FIPS-validated modules provided by the provider. | Provider FedRAMP package; **[agency]** KMS key policies. |
| **SC-13** Cryptographic Protection | Inherited (Hybrid config) | FIPS 140-validated cryptographic modules from the cloud provider; agency selects FIPS endpoints/algorithms. | Provider CMVP cert refs; **[agency]** FIPS-endpoint confirmation. |
| **SC-28** Protection of Information at Rest | Hybrid | KB data, vectors (Aurora GovCloud), sessions (ElastiCache GovCloud), and audit data (CloudWatch) encrypted at rest inside GovCloud. | **[agency]** per-store encryption + KMS key evidence. |

## System and Information Integrity (SI)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **SI-4** System Monitoring | Hybrid | `SecurityEvent`s for `prompt_injection_suspected`, `auth_failure`, `rate_limit_exceeded`, `unauthorized_namespace`, `knowledge_poisoning_suspected` feed monitoring/IR. | `SecurityEvent` in `types.ts`; **[agency]** SIEM integration + alert thresholds. |
| **SI-10** Information Input Validation | Hybrid | Server-controlled system prompt (not user-modifiable); user input sanitized before concatenation; env schema validates federal invariants at startup. | Prompt-injection hardening notes; env-schema validation. |
| **SI-12** Information Management & Retention | Hybrid | No raw query/response retention (`LOG_RESPONSES=false`; `sha256` only when `LOG_QUERY_HASHES=true`); bounded session memory (`SESSION_MAX_TURNS`). | `federal/.env.federal.example`; **[agency]** retention-schedule alignment. |

## Configuration Management (CM)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **CM-2** Baseline Configuration | Hybrid | Baseline defined as code: `/federal/infra/terraform-govcloud` or `/federal/infra/azure-gov` + `federal/.env.federal.example`. | **[agency]** approved baseline snapshot, pinned versions. |
| **CM-6** Configuration Settings | Hybrid | Secure settings enforced by env schema (federal invariants, `PGVECTOR_SSL=require`, audit/PII/SAML/residency flags); dependencies pinned in `package.json`. | **[agency]** documented setting deviations + approvals. |

## Contingency Planning (CP)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **CP-9** System Backup | Inherited (Hybrid config) | Managed backups for Aurora and ElastiCache provided by the cloud provider. | Provider package; **[agency]** backup schedule/retention config. |
| **CP-10** System Recovery & Reconstitution | Hybrid | Infrastructure reconstitutable from IaC; knowledge base reconstitutable via `scripts/ingest.ts`. | **[agency]** recovery procedures + tested-restore evidence (RPO/RTO). |

## Incident Response (IR)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **IR-4** Incident Handling | Agency-owned | `/federal/compliance/IR-runbook.md` covers data breach, prompt injection, unauthorized access, outage; audit `SecurityEvent`s drive detection. | **[agency]** roles, escalation paths, lessons-learned records. |
| **IR-6** Incident Reporting | Agency-owned | Application surfaces detections; reporting timelines are agency policy. | **[agency]** US-CERT/CISA + FedRAMP notification timelines. |

## Risk Assessment (RA)

| Control | Ownership | How this system supports it | Evidence / Notes |
|---|---|---|---|
| **RA-5** Vulnerability Monitoring & Scanning | Hybrid | `npm audit` in CI on every PR; agency-approved SAST/DAST added for federal; continuous monitoring requires monthly scans + annual pen test + POA&M. | **[agency]** scan reports, pen-test results, POA&M tracker. |

---

## Inheritance summary

| Bucket | Examples in this system |
|---|---|
| **Inherited** | SC-12, SC-13 crypto modules; AU-9 storage protection (base); CP-9 managed backups; provider physical/environmental/hypervisor controls (from the GovCloud / Azure Gov FedRAMP package). |
| **Hybrid** | AC-3, AC-6, AC-17; AU-2, AU-3, AU-12; IA-2; SC-7, SC-8, SC-28; SI-4, SI-10, SI-12; CM-2, CM-6; CP-10; RA-5. |
| **Agency-owned** | AC-2; AU-6; IA-5, IA-8; IR-4, IR-6; plus all assessment/authorization activities, ODP selection, knowledge-base content, and IdP/PKI configuration. |

> This matrix covers a representative subset for a Low/Moderate/High tailoring
> discussion. The full applicable baseline (all controls and enhancements for the
> categorization recorded in the SSP) must be addressed before assessment. Ownership
> labels are starting points to be confirmed against the cloud provider's Customer
> Responsibility Matrix (CRM) and the agency's tailoring decisions.
