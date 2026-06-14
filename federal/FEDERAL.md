# Federal Deployment Guide — FedRAMP + Section 508

> **Audience:** GovTech contractors deploying this agent inside a federal authorization
> boundary, and the agency Information System Security Officer (ISSO) who will own its
> Authority to Operate (ATO).
>
> Everything described here lives in the `federal/` directory. The federal tier is
> **opt-in** and is activated by a single switch (`DEPLOYMENT_MODE=federal`). Commercial
> and enterprise deployments are entirely unaffected by anything in this document.

---

## 1. What the federal tier is

> **This is a federal-oriented template / starting point, not a "federal-ready",
> "FedRAMP-ready", or "compliant" product.** It does not, by itself, confer any
> authorization. It still requires your own ATO and an independent 3PAO (or
> agency-designated) assessment. What it gives you is a hardened configuration profile
> and a head start on the compliance package — not the package itself.

The federal tier (Tier 3 in the credential model — see `README.md#configuration`) is a
hardened configuration profile that re-routes every external dependency inside a FedRAMP
authorization boundary and enables the controls a federal system requires:

- LLM inference through GovCloud-resident endpoints, not the commercial provider APIs
- A vector store with a FedRAMP authorization path (pgvector on Aurora GovCloud)
- IAM/workload-identity credentials instead of static API keys
- NIST 800-53-format audit logging with query-hash-only logging
- PII redaction on the ingestion and query path
- Federated identity (SAML 2.0, PIV/CAC) instead of consumer auth
- The Section 508 / WCAG 2.1 AA accessibility build

It is enabled by setting `DEPLOYMENT_MODE=federal`. With that flag unset (the default is
`standard`), none of the federal invariants are enforced and the application behaves
exactly as a commercial deployment. **There is no shared code path that degrades the
commercial experience** — the federal logic is gated entirely behind this flag and the
`superRefine` block in the env schema.

A complete, copy-ready reference configuration is provided in
`federal/.env.federal.example`.

---

## 2. Enforced env invariants — fail fast at boot

The federal tier does not rely on documentation or operator discipline to stay compliant.
The validated environment schema in
`packages/rag-core/src/env/schema.ts` enforces the federal invariants at process
startup. **If any invariant is violated, validation throws and the process refuses to
boot** — there is no degraded or partially-compliant runtime state. Misconfiguration is a
crash at startup, not a silent runtime surprise discovered in production.

The following are enforced when `DEPLOYMENT_MODE=federal` (and one is enforced
unconditionally whenever `bedrock-gov` is selected):

| Invariant | Rule enforced | Why |
|---|---|---|
| **GovCloud region for Bedrock** | If `LLM_PROVIDER=bedrock-gov`, then `AWS_REGION` must be `us-gov-west-1` or `us-gov-east-1` | The commercial Bedrock regions sit outside the FedRAMP boundary. Inference on CUI/federal data must execute on GovCloud infrastructure. This check fires regardless of `DEPLOYMENT_MODE`, so even an enterprise misconfiguration pointing GovCloud at a commercial region is rejected. |
| **Pinecone rejected** | `VECTOR_STORE` may not be `pinecone` | Pinecone has no FedRAMP authorization. Storing embedded federal content there places it outside the boundary. The schema rejects it outright; use `pgvector` (Aurora GovCloud). |
| **pgvector TLS required** | If `VECTOR_STORE=pgvector`, then `PGVECTOR_SSL` must be `require` | The default (`prefer`) silently permits an unencrypted connection. `require` mandates TLS in transit to the vector store, satisfying encryption-in-transit control expectations (SC-8). |
| **Auth mandatory** | `AUTH_ENABLED` must be `true` | A federal system cannot serve anonymous traffic. Identity is a prerequisite for access control (AC-3), accountability, and audit (AU-2). |

Note the GovCloud-region check is *unconditional* on the provider: selecting
`bedrock-gov` always requires a `us-gov-*` region even outside federal mode, so the
"GovCloud provider, commercial region" mistake can never reach runtime.

These are deliberately coarse, boot-time guardrails — they are necessary, not sufficient.
They prevent the most damaging and most common misconfigurations from ever reaching
runtime. They do **not** replace the full controls assessment described below.

---

## 3. FedRAMP impact level selection

Choose the impact level **before** selecting a provider, because the level dictates which
provider authorization path is acceptable. Set the chosen level in `IMPACT_LEVEL`
(`low` | `moderate` | `high`) and the corresponding data sensitivity in
`DATA_CLASSIFICATION` (`public` | `CUI` | `sensitive`).

| Impact level | Typical system | Provider path that fits | Env |
|---|---|---|---|
| **Low** | Public-facing informational tools; no PII or sensitive data | Either GovCloud path is acceptable | `IMPACT_LEVEL=low`, `DATA_CLASSIFICATION=public` |
| **Moderate** | Most civilian-agency internal tools | OpenAI via **Azure Government** (`azure-gov`) — carries FedRAMP Moderate | `IMPACT_LEVEL=moderate`, `LLM_PROVIDER=azure-gov` |
| **High** | Systems handling **CUI**, law enforcement, or health data | Claude via **AWS Bedrock GovCloud** (`bedrock-gov`) — High path for CUI | `IMPACT_LEVEL=high`, `DATA_CLASSIFICATION=CUI`, `LLM_PROVIDER=bedrock-gov` |

The reference `federal/.env.federal.example` ships configured for the **High / CUI** case
(Bedrock GovCloud, `IMPACT_LEVEL=high`, `DATA_CLASSIFICATION=CUI`). Always confirm the
current FedRAMP authorization status of any provider against the official FedRAMP
Marketplace before relying on it for your ATO package — authorization scope changes over
time.

---

## 4. GovCloud access setup

You cannot call `api.anthropic.com` or `api.openai.com` from a federal deployment. All
inference routes through the authorized cloud boundary, and credentials are assumed via
workload identity — **never static keys** (a static key in `.env` is a NIST 800-53
violation at High impact level).

### 4a. AWS Bedrock GovCloud (Claude — FedRAMP High path)

```env
LLM_PROVIDER=bedrock-gov
AWS_REGION=us-gov-west-1                          # or us-gov-east-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6
# Embeddings stay inside the boundary too:
EMBEDDING_PROVIDER=bedrock
EMBEDDING_MODEL=amazon.titan-embed-text-v2:0
# Zero static credentials — ECS task role / EC2 instance profile assumed at runtime.
```

Setup steps:

1. **Provision model access.** In the GovCloud Bedrock console, request/enable access to
   the Claude model(s) you intend to use. Model availability differs between GovCloud and
   commercial regions — verify the exact model ID is offered in your `us-gov-*` region.
2. **Workload identity / IAM task role.** Attach an IAM role to the ECS task (or EC2
   instance profile) granting least-privilege `bedrock:InvokeModel` /
   `bedrock:InvokeModelWithResponseStream` on only the model ARNs you use. The runtime
   assumes this role automatically; no key material is stored anywhere.
3. **Region.** `AWS_REGION` must be a GovCloud region — the schema rejects any other
   value for `bedrock-gov` at boot.

IaC for the full stack (ECS, Aurora pgvector, ElastiCache, IAM) is in
`federal/infra/terraform-govcloud/` — see §8.

### 4b. Azure Government (OpenAI — FedRAMP Moderate path)

```env
LLM_PROVIDER=azure-gov
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.us   # .azure.us, not .azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o-gov
AZURE_OPENAI_API_VERSION=2024-08-01-preview
# Zero static credentials — Azure Managed Identity assumed at runtime.
```

Setup steps:

1. **Endpoints.** Azure Government uses the `.azure.us` sovereign-cloud domain, not the
   commercial `.azure.com`. Point `AZURE_OPENAI_ENDPOINT` at your Gov resource.
2. **Managed Identity.** Assign a system- or user-assigned Managed Identity to the App
   Service / container and grant it the `Cognitive Services OpenAI User` role on the
   resource. The runtime authenticates via the identity — no API key in `.env`.
3. **Deployment name.** `AZURE_OPENAI_DEPLOYMENT` is the *deployment* you created in the
   Gov resource, which may differ from the underlying model name.

ARM templates are in `federal/infra/azure-gov/` — see §8.

> **First-party / research-lab models.** For an agency-internal serving stack, set
> `LLM_PROVIDER=internal` and point `INTERNAL_LLM_ENDPOINT` at your infrastructure
> (mTLS via `INTERNAL_LLM_CERT_PATH` / `INTERNAL_LLM_KEY_PATH`). See
> `README.md#configuration` Tier 3 for the contract.

---

## 5. SAML 2.0 / PIV-CAC authentication

Federal deployments use federated identity backed by the agency Identity Provider (IdP),
typically fronted by PIV/CAC smart-card login. Consumer auth (Clerk) is not in boundary.

```env
AUTH_ENABLED=true                       # enforced by the schema in federal mode
AUTH_PROVIDER=saml
SAML_ENTRY_POINT=https://agency-idp.gov/sso   # the agency IdP SSO URL
SAML_ISSUER=rag-chat-agent                    # this app's SP entity ID / issuer
```

- `AUTH_PROVIDER=saml` selects the SAML 2.0 service-provider flow.
- `SAML_ENTRY_POINT` is the agency IdP's SSO endpoint — users are redirected there, and
  the PIV/CAC card challenge is handled by the IdP, not this application.
- `SAML_ISSUER` is this system's SP entity ID, registered with the agency IdP.

PIV/CAC is enforced upstream at the IdP. The application consumes the resulting SAML
assertion; it never touches the certificate. `AUTH_ENABLED=true` is non-negotiable in
federal mode — the schema refuses to boot without it.

---

## 6. Controls inheritance model

A federal ATO does not require you to implement every NIST 800-53 control yourself. The
control set is partitioned three ways:

- **Inherited** — satisfied by the underlying FedRAMP-authorized platform (AWS GovCloud,
  Azure Government). Physical, environmental, and much of the infrastructure-layer control
  set is inherited from the cloud provider's authorization package. You cite their ATO.
- **Shared** — partly the platform's, partly yours (e.g. encryption: the platform offers
  it, you must configure `PGVECTOR_SSL=require`, IAM scoping, etc.).
- **Agency-owned** — controls only you can satisfy: your data classification, your access
  policies, your incident response, your knowledge-base governance, your accessibility.

The mapping of which control falls in which bucket for **this** architecture is in:

- **`federal/compliance/controls-matrix.md`** — NIST 800-53 Rev 5 controls mapped to
  inherited vs. agency-owned, including which require continuous evidence collection.

Supporting templates:

- **`federal/compliance/SSP-template.md`** — System Security Plan, pre-populated for this
  architecture.
- **`federal/compliance/VPAT.md`** — Voluntary Product Accessibility Template (§9).
- **`federal/compliance/IR-runbook.md`** — Incident response runbook for data breach,
  prompt injection, unauthorized access, and outage.

---

## 7. ATO process overview

**These are templates, not approvals.** Shipping this repo does not confer an Authority to
Operate, and nothing in `federal/compliance/` should be presented to an Authorizing
Official as a finished assessment.

The path to ATO, in brief:

1. **Select impact level and provider path** (§3) and stand up the boundary (§8).
2. **Tailor the SSP** (`SSP-template.md`) to your actual deployment — every templated
   section needs agency-specific detail.
3. **Complete the controls matrix** (`controls-matrix.md`), documenting evidence for each
   agency-owned and shared control.
4. **Independent assessment.** A Third-Party Assessment Organization (3PAO) or independent
   assessor must test the controls and produce a Security Assessment Report (SAR).
5. **Agency ISSO sign-off.** The agency ISSO and Authorizing Official review the package
   and issue (or deny) the ATO. **Both the independent assessor and the agency ISSO
   sign-off are required** — neither is optional.

**Continuous monitoring** obligations begin the day the ATO is granted and never stop:

- **Monthly** vulnerability scans of the boundary.
- **Annual** penetration test.
- **POA&M** (Plan of Action and Milestones) — every identified weakness is tracked to
  closure with owners and dates.

The controls matrix flags which controls require ongoing evidence collection. See also the
"FedRAMP continuous monitoring" and "Lifecycle and maintenance" sections of `README.md`.

---

## 8. Infrastructure

Infrastructure-as-code for both boundaries lives under `federal/infra/`:

- **`federal/infra/terraform-govcloud/`** — AWS GovCloud Terraform: ECS (the application),
  Aurora PostgreSQL with pgvector (the vector store), ElastiCache (session store), and the
  IAM roles for workload identity. This is the path for the FedRAMP High / Bedrock GovCloud
  configuration.
- **`federal/infra/azure-gov/`** — Azure Government ARM templates: App Service, the
  Azure OpenAI (`azure-gov`) resource wiring, and Managed Identity assignments. This is the
  path for the FedRAMP Moderate / Azure Gov configuration.

Both keep all data residency CONUS and inside the boundary; pair this with
`ENFORCE_DATA_RESIDENCY=true` and `ALLOWED_REGIONS=us-gov-west-1,us-gov-east-1` in your
environment.

---

## 9. Section 508 accessibility

Section 508 makes WCAG 2.0 Level AA the legal baseline. This system targets **WCAG 2.1
Level AA** — the level agencies actively request. Enable the accessibility build with:

```env
A11Y_MODE=true            # WCAG 2.1 AA build + announcement buffering
STREAM_BUFFER_MS=500      # buffer streamed tokens before announcing to screen readers
```

Why `STREAM_BUFFER_MS` matters: token-by-token streaming is inaccessible — text changing
many times per second cannot be tracked by a screen reader. With `A11Y_MODE=true` the
stream still renders visually in real time, but the `aria-live` region only announces
complete units of text, debounced by `STREAM_BUFFER_MS` (default 500 ms). The web app
build (`apps/web`) additionally provides logical keyboard order, `role="log"` /
`aria-live="polite"` on the message list, `role="status"` on the typing indicator,
descriptive source-citation labels, 4.5:1 contrast, and no layout break at 200% zoom.

**VPAT.** A pre-filled Voluntary Product Accessibility Template is provided at
`federal/compliance/VPAT.md`. Most federal procurements require a VPAT before contract
award. Re-review and re-publish it whenever the UI changes — accessibility conformance
degrades silently as the interface evolves (see the 508 maintenance cadence in
`README.md`).

---

## Quick reference

| Concern | Setting / location |
|---|---|
| Activate federal tier | `DEPLOYMENT_MODE=federal` |
| Reference config | `federal/.env.federal.example` |
| Enforced invariants | `packages/rag-core/src/env/schema.ts` (`superRefine`) |
| Impact level | `IMPACT_LEVEL` (`low`/`moderate`/`high`) + `DATA_CLASSIFICATION` |
| LLM (High / CUI) | `LLM_PROVIDER=bedrock-gov`, `AWS_REGION=us-gov-west-1` |
| LLM (Moderate) | `LLM_PROVIDER=azure-gov`, `*.openai.azure.us` |
| Auth | `AUTH_PROVIDER=saml`, `SAML_ENTRY_POINT`, `SAML_ISSUER` |
| Controls / SSP / VPAT / IR | `federal/compliance/` |
| Infrastructure | `federal/infra/terraform-govcloud/`, `federal/infra/azure-gov/` |
| Accessibility | `A11Y_MODE=true`, `STREAM_BUFFER_MS`, `federal/compliance/VPAT.md` |
