# Configuration reference

Every configurable option in `rag-chat-agent`, grouped by area.

All configuration is environment variables. They are read and validated **once**, at startup, by `packages/rag-core`'s zod env schema — no other module reads `process.env` directly. Invalid combinations are rejected at boot with a message that links back to the relevant section here.

- Commercial template: [`.env.example`](.env.example) — copy to `.env.local` (Tier 1 dev) or `.env` (Tier 2 enterprise).
- Federal template: [`federal/.env.federal.example`](federal/.env.federal.example) — Tier 3.
- Federal deployment guide: [`federal/FEDERAL.md`](federal/FEDERAL.md).

---

## Credential tiers — read this first

How API credentials are provisioned depends entirely on who is deploying and at what scale. There are three distinct models and they are **not** interchangeable.

| | Tier 1 (Dev) | Tier 2 (Enterprise) | Tier 3 (Federal) |
|---|---|---|---|
| Who manages the key | You | IT / AI platform team | IAM system (no key) |
| Where key lives | `.env.local` | Secrets Manager / Key Vault | Not applicable |
| LLM access path | Direct provider API | Bedrock / Vertex / Azure OpenAI | Bedrock GovCloud / Azure Gov |
| Key rotation | Manual | Automated by platform team | IAM role — no rotation needed |
| Appropriate for | Dev, prototypes | Enterprise production | Federal, DoD, regulated |
| Static key in `.env` | Yes | No | Never |

- **Tier 1 — Developer (direct API key).** Grab a key from `console.anthropic.com` or `platform.openai.com`, paste it in `.env.local`, run. Fine for local dev, prototypes, and small single-team deployments. Not appropriate for any org where someone else owns the budget, security policy, or compliance posture.
- **Tier 2 — Enterprise (managed platform).** The key is provisioned by IT / a central AI platform team, scoped to your app, rotated on a schedule, and delivered via a secrets manager. LLM access goes through a managed endpoint (Bedrock, Vertex, Azure OpenAI), not the consumer API. Joining devs get an endpoint and either a scoped key or SSO instructions — no key to paste.
- **Tier 3 — Federal / PubSec (GovCloud boundary, IAM-only).** Same pattern as Tier 2 but inside the FedRAMP authorization boundary. Static keys are a NIST 800-53 violation at High impact — credentials are always assumed via IAM role / workload identity at runtime, never stored. See [Federal deployment](#federal-deployment).

---

## LLM provider

Set `LLM_PROVIDER`; the matching adapter in `packages/llm-adapters` normalizes the interface. No code changes are needed to switch.

| Tier | Allowed `LLM_PROVIDER` values |
|---|---|
| 1 (dev) | `anthropic`, `openai` |
| 2 (enterprise) | `bedrock`, `vertex`, `azure-openai` |
| 3 (federal) | `bedrock-gov`, `azure-gov`, `internal` |

### Required variables per provider

| Provider | Required vars | Credential model |
|---|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` | Direct key (Tier 1) |
| `openai` | `OPENAI_API_KEY` | Direct key (Tier 1) |
| `bedrock` | `AWS_REGION`, `AWS_BEDROCK_MODEL` | No static key — default AWS credential chain (IAM role / `aws sso login`) |
| `bedrock-gov` | `AWS_REGION` (**must be a `us-gov-*` region**), `AWS_BEDROCK_MODEL` | No static key — ECS task role / instance profile |
| `vertex` | `VERTEX_PROJECT`, `VERTEX_LOCATION`, `VERTEX_MODEL` | Application Default Credentials (ADC) |
| `azure-openai` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT` (+ `AZURE_OPENAI_API_VERSION`) | Key via Key Vault / Managed Identity — not in `.env` |
| `azure-gov` | `AZURE_OPENAI_ENDPOINT` (**must be a `*.azure.us` endpoint**), `AZURE_OPENAI_DEPLOYMENT` | Azure Managed Identity |
| `internal` | `INTERNAL_LLM_ENDPOINT`, `INTERNAL_LLM_MODEL`, `INTERNAL_LLM_CERT_PATH`, `INTERNAL_LLM_KEY_PATH` (+ optional `INTERNAL_LLM_CA_PATH`) | mTLS client cert (agency PKI) |

Notes:

- `bedrock` / `bedrock-gov` and `azure-openai` / `azure-gov` share the same vars; the `-gov` variants only add the region / endpoint constraint above.
- `internal` expects an OpenAI-compatible `/v1/chat/completions` interface over mTLS. If your serving infra has a different API shape, implement a thin adapter in `packages/llm-adapters/src/internal.ts`.

---

## Choosing a model

`LLM_MODEL` selects the model (or `AWS_BEDROCK_MODEL` / `VERTEX_MODEL` / `AZURE_OPENAI_DEPLOYMENT` for the platform providers).

- **Default:** `claude-sonnet-4-6` — kept lean for a boilerplate; a strong general-purpose balance of cost and capability.
- **Most capable:** `claude-opus-4-8` — reach for this when answer quality on hard queries matters more than cost/latency.
- **Sampling params are swap-safe.** `TEMPERATURE` (and other sampling params) are **automatically omitted** on models that reject them — Opus 4.7+/4.8 and Fable 5. You can change `LLM_MODEL` to one of those models without touching your sampling config; the adapter strips the unsupported params for you.

| Var | Default | Notes |
|---|---|---|
| `LLM_MODEL` | `claude-sonnet-4-6` | Logical model id (Tier 1 / direct). |
| `MAX_TOKENS` | `1024` | Max tokens in the generated response. |
| `TEMPERATURE` | `0.2` | Auto-omitted on models that reject sampling params (see above). |

---

## Embeddings

| Var | Default | Values |
|---|---|---|
| `EMBEDDING_PROVIDER` | `openai` | `openai` \| `cohere` \| `voyage` \| `bedrock` \| `vertex` |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Provider-specific model id |
| `COHERE_API_KEY` | — | Required when `EMBEDDING_PROVIDER=cohere` |
| `VOYAGE_API_KEY` | — | Required when `EMBEDDING_PROVIDER=voyage` |

> **Heads up:** the **default OpenAI embeddings require `OPENAI_API_KEY` even when your LLM is Anthropic.** Anthropic has no first-party embeddings API, so the dev quickstart (Anthropic LLM + Chroma) still needs an embeddings provider. To run an **OpenAI-free** path, use **`voyage` or `cohere`** (each needs its own key above). Under federal, embeddings run inside the GovCloud boundary via `bedrock` (e.g. `amazon.titan-embed-text-v2:0`).

> Changing the embedding model is disruptive: new vectors are incompatible with old ones, so the **entire vector store must be re-embedded**. Schedule it as a maintenance window.

> **Asymmetric doc/query mode is handled automatically.** Providers that distinguish how a document vs. a search query is embedded are driven in the correct mode for you — documents at ingest time, queries at retrieval time — so a query and the document that should answer it are pushed closer together. The mode mapping: **Cohere** `search_query` / `search_document`, **Voyage** `query` / `document`, **Vertex** `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT` (Cohere-on-Bedrock uses the Cohere pair). **OpenAI** and **Amazon Titan** are **symmetric** — they ignore the distinction, and no configuration is needed either way.

---

## Vector store

Pick one via `VECTOR_STORE`. Adapters live in `packages/vector-adapters`.

| Var | Default | Values |
|---|---|---|
| `VECTOR_STORE` | `chroma` | `chroma` \| `pinecone` \| `pgvector` \| `weaviate` |

Per-store variables:

| Store | Variables |
|---|---|
| `chroma` | `CHROMA_URL` (default `http://localhost:8000`) |
| `pinecone` | `PINECONE_API_KEY`, `PINECONE_INDEX` |
| `weaviate` | `WEAVIATE_URL`, `WEAVIATE_API_KEY` |
| `pgvector` | `PGVECTOR_HOST`, `PGVECTOR_PORT` (`5432`), `PGVECTOR_DATABASE` (`rag`), `PGVECTOR_USER` (`rag`), `PGVECTOR_PASSWORD`, `PGVECTOR_SSL`, `PGVECTOR_TABLE` (`rag_chunks`) |

`PGVECTOR_SSL` accepts `require` \| `prefer` \| `disable` (default `prefer`).

> The `pgvector` adapter uses **generic** Postgres connection vars and works against **any Postgres + pgvector** instance — AWS Aurora, self-hosted, Supabase, or anything else. This is a deliberate generalization, not Supabase-specific.

> **`PGVECTOR_SSL=require` is enforced under federal.** Pinecone has no FedRAMP authorization and is rejected when `DEPLOYMENT_MODE=federal` — see [Federal deployment](#federal-deployment).

### Retrieval tuning

| Var | Default | Notes |
|---|---|---|
| `TOP_K_RESULTS` | `10` | Candidates retrieved from the vector store before rerank. |
| `TOP_K_AFTER_RERANK` | `5` | Chunks kept after rerank and injected into context. |
| `RERANKER` | `hybrid` | `hybrid` (dependency-free) or `cohere` (cross-encoder). See [Rerank](#rerank). |
| `RERANK_MODEL` | — | Overrides the Cohere rerank model id (`RERANKER=cohere` only). |
| `HYBRID_SEARCH` | `false` | `true` layers BM25 keyword search on top of semantic search. Recommended for exact-match terminology (and for federal). |

---

## Rerank

Initial retrieval casts wide (`TOP_K_RESULTS`); the reranker refines down to `TOP_K_AFTER_RERANK` before generation. This consistently outperforms naive top-K alone, so reranking is on by default.

- **Default reranker (`RERANKER=hybrid`):** a dependency-free **lexical + vector hybrid** scorer (top-K → top-N). No extra service or API key required.
- **Cohere cross-encoder (`RERANKER=cohere`):** higher-quality reranking via Cohere's rerank API. Requires `COHERE_API_KEY`; set `RERANK_MODEL` to override the default model (`rerank-english-v3.0`). Selecting `cohere` without a key fails fast at startup.

---

## Ingestion

The `packages/ingestion` pipeline chunks, embeds, and pushes documents to the vector store.

| Var | Default | Notes |
|---|---|---|
| `CHUNK_SIZE` | `512` | Tokens per chunk. 256–512 for API docs / FAQs; ~1024 for long-form PDFs. |
| `CHUNK_OVERLAP` | `64` | Token overlap between adjacent chunks. |

Chunking is recursive text splitting with semantic boundary awareness. Both values are configurable per ingest run.

### Loaders

| Source type | Notes |
|---|---|
| `pdf` | Text extraction + table detection |
| `md` | Markdown / MDX — preserves heading structure in metadata |
| `docx` | Headings and paragraphs |
| `txt` | Any plain-text file |
| `url` | Crawls a single page (Cheerio) |
| `sitemap` | Crawls all pages listed in `sitemap.xml` |
| `notion` | Notion API (integration token) |
| `confluence` | Confluence REST API |

### Source credentials (read by the ingest CLI)

| Var | Used by |
|---|---|
| `NOTION_TOKEN` | Notion loader |
| `CONFLUENCE_BASE_URL` | Confluence loader |
| `CONFLUENCE_EMAIL` | Confluence loader |
| `CONFLUENCE_API_TOKEN` | Confluence loader |

### Commands

```bash
# Ingest documents into a namespace
npm run ingest -- --source ./docs --type pdf,md --namespace acme-corp
npm run ingest -- --source https://yoursite.com/docs --type url --namespace acme-corp

# Seed an example knowledge base
npm run seed
```

`--namespace` lets you re-ingest an individual document set without rebuilding the whole knowledge base.

### Source security (SSRF / file reads)

The ingestion loaders fetch operator-supplied URLs and read operator-supplied paths. On the hosted admin route (`/api/ingest`) those inputs are effectively attacker-influenced, so the url/sitemap/confluence/file loaders run behind a deny-by-default security policy (`packages/ingestion/src/loaders/security.ts`). Defaults are safe out of the box; the variables below tighten them further.

| Var | Default | Notes |
|---|---|---|
| `INGEST_ROOT` | — | When set, every file path is confined to this directory after `..`/symlink resolution (a trailing-separator prefix check, so `/data/ingest-evil` can't pose as a child of `/data/ingest`). Unset → local paths are trusted unchanged (the CLI legitimately reads anywhere). |
| `INGEST_URL_ALLOWLIST` | — | Comma-separated host allowlist for the url/sitemap loaders. An entry is an exact host (`example.com`) or a leading-dot suffix (`.example.com`, which matches `a.example.com` **and** bare `example.com`). Unset → any *public* host is allowed (still subject to the private-IP block). An empty list allows nothing. |
| `INGEST_MAX_BYTES` | `10000000` | Hard cap (10 MB) on a fetched body, enforced by streaming and aborting early — protects against decompression-bomb / unbounded-response memory exhaustion even when `Content-Length` lies or is absent. Also caps local PDF/DOCX reads (those loaders buffer the whole file, so the file is size-gated before it is read). |
| `INGEST_TIMEOUT_MS` | `15000` | Per-fetch timeout via `AbortController`; stops a slow-loris endpoint from hanging the crawl. |
| `INGEST_ALLOW_PRIVATE_NETWORKS` | `false` | **DANGER.** `true` skips the private-IP gate entirely. Only for the trusted local CLI crawling an intranet — never for the hosted/admin surface, where it re-opens the SSRF hole. |

What the policy enforces:

- **Scheme gate** — only `http`/`https`. `file:`, `ftp:`, `gopher:`, `data:`, etc. are refused.
- **Private/loopback/link-local/metadata blocking (IPv4 + IPv6)** — fetches to `127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (which includes the `169.254.169.254` cloud-metadata IP), `100.64/10` CGNAT, `0.0.0.0/8`, and the IPv6 equivalents (`::1`, `::`, `fc00::/7` unique-local, `fe80::/10` link-local, and IPv4-mapped `::ffff:a.b.c.d`) are rejected. A public hostname that **resolves** to one of these is also rejected (the gate is applied to every resolved address).
- **Per-request size and timeout caps** — `INGEST_MAX_BYTES` and `INGEST_TIMEOUT_MS` above.
- **Redirect re-validation** — redirects are followed manually with `redirect: "manual"` and **every hop is re-validated** against the same gate, so an allowlisted URL cannot `302` you to `http://169.254.169.254/…`.
- **Confluence base-URL gate** — the Confluence loader validates `CONFLUENCE_BASE_URL` (and every paginated `_links.next` URL) against the same scheme/allowlist/private-IP gate before each request, so a misconfigured base URL can't turn the loader into an SSRF sink.

> **Documented residual limitations.** Two classes of attack are **not** fully covered: (1) **DNS-rebinding TOCTOU** — the host is resolved and checked at validation time, but a hostile resolver could return a different address at connection time; and (2) **exotic host encodings** — unusual IPv6 forms and octal-or-integer-encoded IPv4 hosts may slip past the literal classifier. For hostile environments, **pin IPs at the connection layer** (resolve once, dial the vetted address) rather than relying on this gate alone.

---

## PII redaction

| Var | Default | Values |
|---|---|---|
| `PII_REDACTION_ENABLED` | `false` | `true` for any deployment handling personal data |
| `PII_REDACTION_PROVIDER` | `presidio` | `presidio` \| `aws-comprehend` |
| `PRESIDIO_URL` | `http://localhost:5002` | Presidio service endpoint (when provider is `presidio`) |
| `PRESIDIO_MIN_CONFIDENCE` | `0` | Minimum analyzer confidence `[0,1]` for a span to be redacted. `0` redacts every detection (conservative default); raise it (e.g. `0.6`–`0.8`) to suppress low-confidence false positives at the cost of recall. |

Federal deployments enable redaction with `aws-comprehend` inside the GovCloud boundary.

---

## Auth

The auth gate is **secure by default**. When `AUTH_ENABLED=true` and **no token verifier is configured**, the API **fails closed** — every request is rejected with `503`. There is no "any non-empty bearer token is a valid user" fallback; you opt back into that explicitly, for dev only.

You make the gate functional one of three ways:

1. **Register a real verifier** with `setTokenVerifier(verifier)` — a Clerk / NextAuth session check, a JWKS validator, or a SAML assertion check. A verifier maps a bearer token to a `VerifiedIdentity` (`userId`, optional `isAdmin`, optional `namespaceAccess`) or returns `null` to reject. It's async, so JWKS/IdP round-trips fit. Register it once at startup — typically in `apps/web/instrumentation.ts`.
2. **Use the built-in static-token verifier** via `AUTH_STATIC_TOKENS` — a JSON array of identities, good for simple and test deployments without extra code.
3. **Opt into insecure tokens** with `AUTH_ALLOW_INSECURE_TOKENS=true` — **local dev only.**

Resolution order on a request: `AUTH_ENABLED=false` → open (treated as a local admin, `"any"` namespace, so `npm run dev` can ingest); else no bearer token → `401`; else a registered verifier decides; else `AUTH_STATIC_TOKENS`; else `AUTH_ALLOW_INSECURE_TOKENS`; else **fail closed (`503`)**.

| Var | Default | Values / notes |
|---|---|---|
| `AUTH_ENABLED` | `false` | Gate the API routes behind auth. `false` = open (dev / public widget). |
| `AUTH_STATIC_TOKENS` | — | JSON array of identities for the built-in verifier: `[{"token":"...","userId":"ops","admin":true,"namespaces":["acme"]}]`. `userId` defaults to the token; `admin` defaults to `false`; `namespaces` pins tenant access (omit → `AUTH_DEFAULT_NAMESPACE`). Malformed JSON fails loudly rather than silently disabling auth. |
| `AUTH_ALLOW_INSECURE_TOKENS` | `false` | **DEV ONLY.** Treat any non-empty bearer token as an opaque user id with **no tenant scope**. Forbidden under `DEPLOYMENT_MODE=federal` (rejected at boot). |
| `AUTH_DEFAULT_NAMESPACE` | `default` | Namespace granted to a verified identity that doesn't pin its own `namespaces`. |
| `AUTH_PROVIDER` | `clerk` | `clerk` \| `nextauth` \| `saml` — a hint for which integration you're wiring; the verifier you register is what actually enforces auth. |
| `CLERK_SECRET_KEY` | — | Used by a Clerk verifier when `AUTH_PROVIDER=clerk` |
| `SAML_ENTRY_POINT` | — | IdP SSO URL when `AUTH_PROVIDER=saml` |
| `SAML_ISSUER` | `rag-chat-agent` | SAML issuer / entity id |
| `AUTH_RATE_LIMIT` | `50` | Requests/min per user or IP on `/api/chat` |

### Tenant → namespace binding

A verified identity carries which namespace(s) it may touch. Routes call `authorizeNamespace(auth, requested)`, so **a caller may only use namespaces its identity permits** — passing an arbitrary `namespace` in the request body cannot reach another tenant's data. `namespaceAccess: "any"` lifts the restriction (single-tenant / trusted deployments); an explicit list pins multi-tenant isolation. Note that **admin status does not widen namespace access** — grant `"any"` or list namespaces explicitly.

### Admin-gated ingestion

Ingestion is privileged: `/api/ingest` requires an **admin** identity (`requireAdmin`). In a static-token entry, set `"admin": true`. Anyone who can ingest can change what the bot tells every user — treat ingest access like write access to a production database.

### How the browser sends its token

When `AUTH_ENABLED=true`, the browser sends its token as `Authorization: Bearer <token>`. By default `useChat` reads that token from `sessionStorage["rag_auth_token"]` (the documented seam a host page populates after its own login). Override it by passing a `getAuthToken` callback to `useChat` — e.g. to source the token from your auth provider's client SDK (Clerk's `getToken`). Returning `null`/`undefined` sends no header (correct for the default `AUTH_ENABLED=false` demo).

> **Browser-exposed tokens must be short-lived and scoped.** A token readable by client JavaScript can leak; mint per-session, least-privilege, expiring tokens — never a long-lived admin token in the browser.

---

## Audit logging

Structured, NIST 800-53-format audit events (`packages/audit-logger`).

| Var | Default | Values / notes |
|---|---|---|
| `AUDIT_LOG_ENABLED` | `false` | `true` for enterprise and federal |
| `AUDIT_LOG_TARGET` | `console` | `console` \| `cloudwatch` \| `s3` \| `splunk` |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | Retention window (federal commonly `1095` = 3 years) |
| `LOG_QUERY_HASHES` | `false` | `true` logs a hash of the query (federal). Raw query text is never logged. |
| `LOG_RESPONSES` | `false` | Responses may contain PII — off by default |

Target-specific variables:

| Target | Variables |
|---|---|
| `cloudwatch` | `AUDIT_CLOUDWATCH_LOG_GROUP`, `AUDIT_CLOUDWATCH_LOG_STREAM` |
| `s3` | `AUDIT_S3_BUCKET`, `AUDIT_S3_PREFIX` |
| `splunk` | `AUDIT_SPLUNK_URL`, `AUDIT_SPLUNK_TOKEN` |

> **Raw query and response text is never logged.** At most, `LOG_QUERY_HASHES` records a one-way hash of the query; response bodies are only included if you explicitly set `LOG_RESPONSES=true`.

---

## Response cache

| Var | Default | Notes |
|---|---|---|
| `CACHE_ENABLED` | `true` | Enable semantic response caching. |
| `CACHE_TTL_SECONDS` | `86400` | Entry lifetime (24h). |
| `CACHE_SIMILARITY_THRESHOLD` | `0.93` | Min query similarity for a cache hit. |
| `CACHE_INVALIDATE_ON_MODEL_CHANGE` | `true` | Auto-clears the cache when `LLM_MODEL` changes, so old-model answers aren't served under a new model. |

---

## Accuracy guardrails

The guardrails **fail closed**: an answer the pipeline cannot vouch for is **escalated** for human handoff rather than served as authoritative.

| Var | Default | Notes |
|---|---|---|
| `MIN_RETRIEVAL_CONFIDENCE` | `0.70` | Below this top-chunk similarity, the query hits the low-confidence fallback. |
| `STRICT_GROUNDING` | `false` | `true` = an answer with **zero valid citations** is escalated rather than served as authoritative. Recommended for regulated/high-stakes deployments where an ungrounded answer is worse than no answer. |
| `FAITHFULNESS_CHECK` | `false` | `true` for high-stakes / regulated deployments — verifies the answer is grounded in retrieved context. |
| `FAITHFULNESS_THRESHOLD` | `0.85` | Min faithfulness score when the check is on. |
| `MAX_CONTEXT_TOKENS` | — | Caps the size of the assembled context window. |
| `QUERY_REWRITE` | — | Enables the optional LLM query-rewrite step (improves retrieval on vague queries). |

### Escalation behaviour

When the pipeline escalates, the response carries `escalate: true` and a machine-readable `escalateReason` the surface can act on (badge, route to a human, or suppress) — e.g. `low_retrieval_confidence`, `no_grounded_citations`, `faithfulness_below_threshold`, `faithfulness_unparseable`.

> **An unparseable faithfulness score now escalates.** Previously a score the judge model returned in an unreadable form was treated as "fully faithful" (fail-open); it is now treated as "could not confirm" and escalates (`escalateReason: "faithfulness_unparseable"`). A score below `FAITHFULNESS_THRESHOLD` escalates as `faithfulness_below_threshold`.

---

## Session memory

| Var | Default | Notes |
|---|---|---|
| `SESSION_STORE` | `memory` | `memory` \| `redis` |
| `REDIS_URL` | `redis://localhost:6379` | Self-hosted Redis (when `SESSION_STORE=redis`). |
| `UPSTASH_REDIS_URL` | — | Upstash REST endpoint (serverless Redis). |
| `UPSTASH_REDIS_TOKEN` | — | Upstash auth token. |
| `SESSION_MAX_TURNS` | `20` | Bounds conversation memory; older turns are summarized, not dropped. |

---

## Federal deployment

Opt in with `DEPLOYMENT_MODE=federal`. This activates GovCloud routing, PII redaction, NIST audit logging, SAML auth, and the Section 508 accessibility build. Commercial deployments are entirely unaffected. Full guide: [`federal/FEDERAL.md`](federal/FEDERAL.md).

### Enforced invariants

The env schema **rejects boot** unless all of the following hold when `DEPLOYMENT_MODE=federal`:

- `LLM_PROVIDER` ∈ { `bedrock-gov`, `azure-gov`, `internal` } — LLM must route through the GovCloud boundary; commercial `api.anthropic.com` / `api.openai.com` are outside the FedRAMP boundary.
- `AWS_REGION` is a **GovCloud (`us-gov-*`) region** when `LLM_PROVIDER=bedrock-gov`.
- `VECTOR_STORE` **!=** `pinecone` (no FedRAMP authorization).
- `PGVECTOR_SSL=require`.
- `AUTH_ENABLED=true`.
- `AUTH_ALLOW_INSECURE_TOKENS` **!=** `true` — federal mode forbids the dev-only insecure-token fallback; wire a real verifier (see [Auth](#auth)).

### Data residency

`ENFORCE_DATA_RESIDENCY=true` validates `AWS_REGION` **and** `VERTEX_LOCATION` against `ALLOWED_REGIONS` **at startup** — an out-of-boundary region fails fast at boot rather than silently shipping data across a jurisdiction. This applies in **standard mode too** (residency isn't federal-only).

### Federal-specific options

| Var | Default | Notes |
|---|---|---|
| `DEPLOYMENT_MODE` | `standard` | `standard` \| `federal` |
| `IMPACT_LEVEL` | `low` | `low` \| `moderate` \| `high` |
| `DATA_CLASSIFICATION` | `public` | `public` \| `CUI` \| `sensitive` |
| `A11Y_MODE` | `false` | `true` enables the WCAG 2.1 AA build, **forces reduced motion app-wide**, and turns on screen-reader stream buffering. |
| `STREAM_BUFFER_MS` | `500` | Announcement buffering window for `aria-live` (only complete sentences are announced). |
| `ENFORCE_DATA_RESIDENCY` | `false` | `true` validates `AWS_REGION` / `VERTEX_LOCATION` against `ALLOWED_REGIONS` at startup (see above). |
| `ALLOWED_REGIONS` | `us-east-1,us-west-2` | Permitted regions (federal: `us-gov-west-1,us-gov-east-1`). |

> `CACHE_INVALIDATE_ON_MODEL_CHANGE=true` (default) drops cache entries produced by a **previous** model when `LLM_MODEL` changes, so old-model answers are never served under a new model. See [Response cache](#response-cache).

Federal deployments also set `PII_REDACTION_ENABLED=true`, `AUDIT_LOG_ENABLED=true` (typically `cloudwatch`, `AUDIT_LOG_RETENTION_DAYS=1095`, `LOG_QUERY_HASHES=true`), `AUTH_PROVIDER=saml`, and `HYBRID_SEARCH=true`. See [`federal/.env.federal.example`](federal/.env.federal.example) for a complete worked config.

---

## Deployment surface & runtime

| Var | Default | Notes |
|---|---|---|
| `DEPLOYMENT_TARGET` | `web` | `web` \| `slack` \| `teams` \| `widget` \| `all` |
| `SLACK_BOT_TOKEN` / `SLACK_SIGNING_SECRET` / `SLACK_APP_TOKEN` | — | Slack adapter |
| `TEAMS_APP_ID` / `TEAMS_APP_PASSWORD` | — | Teams adapter |
| `WIDGET_ALLOWED_ORIGINS` | `http://localhost:3000` | CORS allowlist for the embeddable widget |
| `BOT_NAME` | `Aria` | Display name |
| `BOT_PERSONA` | (sample) | System prompt — keep it tightly scoped to reduce hallucination |
| `NODE_ENV` | `development` | `development` \| `production` |
| `PORT` | `3000` | API / app port |
| `APP_VERSION` | `0.1.0` | Reported app version |
