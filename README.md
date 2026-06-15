# RAG Chat Agent — Plug & Play Boilerplate

> A model-agnostic, deployment-flexible RAG chatbot starter kit for agencies and businesses. Bring your knowledge base, pick your LLM, choose your deployment surface, and ship.

---

## What this is

A production-ready monorepo that gives any team the full stack needed to run a RAG-powered chat agent — without having to wire everything together from scratch. It is not a SaaS product. It is a starting point you own completely.

Supports:
- **Any LLM** — Claude (Anthropic) or GPT (OpenAI) via a single config switch
- **Any vector store** — Pinecone, Chroma, Supabase pgvector, or Weaviate via adapter pattern
- **Three deployment targets** — Web app (Next.js), Slack/Teams bot, and embeddable widget — selectable per project

---

## Who this is for

| Persona | Use case |
|---|---|
| Digital agency | Stand up a branded chat agent for a client in days, not weeks |
| Federal agency / GovTech contractor | Start from a federal-oriented template — GovCloud routing, Section 508-oriented UI, NIST-format audit logging — inside the authorization boundary. Still requires your own ATO and 3PAO assessment. |
| Internal IT team | Deploy a knowledge base bot to Slack/Teams for employees |
| SaaS product team | Embed a support assistant directly in your app or marketing site |
| Solo developer | Learn how production RAG works without reading 12 different repos |

### A note on scope

This repo is a head start, not a finished product. It gives you the wiring, the patterns, and the configuration scaffolding that would otherwise take weeks to assemble from scratch. What it does not give you is a reason to skip the ongoing work that keeps a RAG system accurate, secure, and compliant. The [lifecycle and maintenance](#lifecycle-and-maintenance) section below is as important as the getting-started guide — read it before you commit to a deployment timeline.

---

## Architecture overview

```
┌─────────────────────────────────────────────────────┐
│                  Deployment Layer                   │
│  ┌──────────────┐ ┌────────────┐ ┌───────────────┐  │
│  │  Web App     │ │ Slack/Teams│ │ Widget (embed)│  │
│  │  (Next.js)   │ │ Bot adapter│ │ (<script> tag)│  │
│  └──────┬───────┘ └─────┬──────┘ └───────┬───────┘  │
└─────────┼───────────────┼────────────────┼──────────┘
          └───────────────┼────────────────┘
                          ▼
┌─────────────────────────────────────────────────────┐
│             API Layer (Next.js route handlers)       │
│  /api/chat   /api/ingest   /api/health              │
│  Auth middleware  |  Rate limiting  |  Streaming    │
└────────────────────────┬────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────┐
│                  RAG Core (typed adapters)           │
│  Query rewrite → Embed query → Retrieve → Rerank    │
│  → Inject context → Generate → Stream response      │
└───────────┬─────────────────────────────┬───────────┘
            ▼                             ▼
┌───────────────────────┐   ┌────────────────────────┐
│  Vector Store Adapter │   │   LLM Provider Adapter │
│  Pinecone | Chroma    │   │   Anthropic | OpenAI   │
│  pgvector | Weaviate  │   │   (config switch)      │
└───────────┬───────────┘   └────────────────────────┘
            ▼
┌───────────────────────┐
│  Ingestion Pipeline   │
│  PDF, Markdown, URL   │
│  Chunk → Embed → Push │
└───────────────────────┘
```

---

## Tech stack

| Layer | Tier 1 (Dev) | Tier 2 (Enterprise) | Tier 3 (Federal) |
|---|---|---|---|
| Frontend | Next.js 14 (App Router) | ← same | ← same + A11Y_MODE=true |
| API | Next.js route handlers | ← same | ← same + NIST audit logger |
| Orchestration | Typed adapter pipeline (hand-rolled) | ← same | ← same |
| LLM | Anthropic direct API | Bedrock / Vertex / Azure OpenAI | Bedrock GovCloud / Azure Gov / 1P internal |
| Embeddings | OpenAI text-embedding-3-small | Bedrock or Vertex embeddings | Same via GovCloud boundary |
| Vector store | Chroma (local) | pgvector or Weaviate | pgvector on Aurora GovCloud |
| Auth | Pluggable, secure-by-default gate (Clerk optional) | NextAuth or org SSO | SAML 2.0 + PIV / CAC |
| Secrets | `.env.local` file | AWS Secrets Manager / Azure Key Vault | IAM role — no stored secrets |
| Deployment | Vercel + Railway | ECS / Azure App Service / GKE | AWS GovCloud ECS / Azure Gov |
| Session store | In-memory | Redis (Upstash or self-hosted) | ElastiCache GovCloud |

---

## Repo structure

```
rag-chat-agent/
├── apps/
│   ├── web/                      # Next.js chat UI (WCAG 2.1 AA compliant build)
│   ├── widget/                   # Embeddable <script> widget
│   └── bot/                      # Slack + Teams adapters
├── packages/
│   ├── rag-core/                 # Typed RAG pipeline, retriever, reranker, cache
│   ├── vector-adapters/          # Pinecone, Chroma, pgvector, Weaviate
│   ├── llm-adapters/             # Claude, OpenAI, Bedrock GovCloud, Azure Gov wrappers
│   ├── ingestion/                # PDF, Markdown, URL loaders + chunker + PII redactor
│   ├── ui-components/            # Shared chat UI components (React, ARIA-annotated)
│   └── audit-logger/             # NIST 800-53-format structured audit log emitter
├── federal/                      # Federal deployment tier (opt-in)
│   ├── .env.federal.example      # GovCloud-specific env config
│   ├── FEDERAL.md                # Federal deployment guide (FedRAMP, 508, ATO)
│   ├── compliance/
│   │   ├── VPAT.md               # Pre-filled Voluntary Product Accessibility Template
│   │   ├── SSP-template.md       # System Security Plan template
│   │   ├── controls-matrix.md    # NIST 800-53 controls — inherited vs agency-owned
│   │   └── IR-runbook.md         # Incident response runbook template
│   └── infra/
│       ├── terraform-govcloud/   # AWS GovCloud IaC — ECS, Aurora pgvector, ElastiCache
│       └── azure-gov/            # Azure Government ARM templates
├── scripts/
│   ├── ingest.ts                 # CLI: push documents to vector store
│   ├── seed.ts                   # CLI: seed example knowledge base
│   ├── audit-report.ts           # CLI: generate audit log report for a date range
│   └── knowledge-health.ts       # CLI: scan for stale, low-coverage, or missing docs
├── docker/
│   ├── docker-compose.yml        # Chroma + Redis local stack
│   └── Dockerfile                # Production API container
├── .env.example                  # Commercial deployment env vars
├── CONFIG.md                     # Every configurable option explained
├── MAINTENANCE.md                # Ongoing maintenance guide and schedules
└── README.md
```

---

## Configuration

Everything is driven by environment variables and the `LLM_PROVIDER` adapter. No code changes required to switch providers or credential modes.

### Credential tiers — read this first

How API credentials work depends entirely on who is deploying this and at what scale. There are three distinct models and they are not interchangeable.

**Tier 1 — Developer / vibe-coding (direct API key)**

You grab an API key from console.anthropic.com or platform.openai.com, paste it in `.env.local`, and run the app. Fast, zero setup, works fine for local development, prototypes, and small single-team deployments. Not appropriate for production at any organisation where someone other than you controls the budget, security policy, or compliance posture.

```env
# .env.local — Tier 1 (dev / solo / small deployment)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...       # your personal key from console.anthropic.com
LLM_MODEL=claude-sonnet-4-6

# or OpenAI
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o
```

**Tier 2 — Enterprise (managed platform, organisation-issued credentials)**

The API key is not yours. It is provisioned by IT or a central AI platform team, scoped to your application, rotated on a schedule, and often delivered via a secrets manager (AWS Secrets Manager, Azure Key Vault, HashiCorp Vault) rather than as a plain string. The LLM access goes through a managed platform endpoint — Azure OpenAI Service, AWS Bedrock, Google Vertex AI — rather than the provider's direct consumer API. This is how enterprise deployments work at scale: the AI platform team manages models, rate limits, cost allocation, and key rotation centrally. Application teams consume an endpoint and a scoped credential, they do not manage the underlying API relationship.

```env
# .env — Tier 2 (enterprise, keys managed by IT / platform team)

# Claude via AWS Bedrock (organisation manages the Bedrock account)
LLM_PROVIDER=bedrock
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6-v1
# No API key here — IAM role assigned to the deployed service at runtime
# Locally: aws sso login, then credentials are injected automatically

# Claude via Google Vertex AI (organisation manages GCP project)
LLM_PROVIDER=vertex
VERTEX_PROJECT=your-gcp-project-id
VERTEX_LOCATION=us-central1
VERTEX_MODEL=claude-sonnet-4-6
# No API key — Application Default Credentials (ADC) used at runtime

# OpenAI via Azure OpenAI Service (organisation provisions the Azure resource)
LLM_PROVIDER=azure-openai
AZURE_OPENAI_ENDPOINT=https://your-org-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o-prod
AZURE_OPENAI_API_VERSION=2024-08-01-preview
# Key delivered via Azure Key Vault or Managed Identity — not stored in .env
```

> **Note for developers joining an enterprise deployment:** you will not have an API key to paste. Your IT or platform team will give you an endpoint URL and either a scoped key from the secrets manager or instructions to authenticate via SSO. If you are unsure which model or deployment name to use, ask the AI platform team — they own that config.

**Tier 3 — Federal / PubSec (GovCloud boundary, IAM-only, no static keys)**

Same pattern as Tier 2 enterprise but inside the FedRAMP authorization boundary. The LLM must be accessed through GovCloud-specific endpoints. Static API keys are a NIST 800-53 violation at High impact level — credentials are always assumed via IAM role at runtime, never stored in environment variables or secrets managers outside the boundary. Key rotation, access logging, and least-privilege scoping are enforced by the cloud provider's IAM system, not the application.

```env
# .env — Tier 3 (federal / pubsec, GovCloud boundary)

# Claude via AWS Bedrock GovCloud
LLM_PROVIDER=bedrock-gov
AWS_REGION=us-gov-west-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6-v1
# Zero static credentials — ECS task role / EC2 instance profile assumed automatically

# OpenAI via Azure Government
LLM_PROVIDER=azure-gov
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.us
AZURE_OPENAI_DEPLOYMENT=gpt-4o-gov
AZURE_OPENAI_API_VERSION=2024-08-01-preview
# Zero static credentials — Azure Managed Identity assumed automatically

# Research lab / 1P access (agency-internal model serving)
LLM_PROVIDER=internal
INTERNAL_LLM_ENDPOINT=https://models.agency-internal.gov/v1
INTERNAL_LLM_MODEL=agency-llm-v2
# Auth via agency PKI / mTLS — certificate path injected by infrastructure
INTERNAL_LLM_CERT_PATH=/run/secrets/client.crt
INTERNAL_LLM_KEY_PATH=/run/secrets/client.key
```

> **Note for agencies using first-party or research lab models:** set `LLM_PROVIDER=internal` and point `INTERNAL_LLM_ENDPOINT` at your internal serving infrastructure. The internal adapter expects an OpenAI-compatible `/v1/chat/completions` interface. If your internal model serves a different API shape, implement a thin adapter in `packages/llm-adapters/src/internal.ts` — the interface is documented in that package's README.

### Credential tier summary

| | Tier 1 (Dev) | Tier 2 (Enterprise) | Tier 3 (Federal) |
|---|---|---|---|
| Who manages the key | You | IT / AI platform team | IAM system (no key) |
| Where key lives | `.env.local` | Secrets Manager / Key Vault | Not applicable |
| LLM access path | Direct provider API | Bedrock / Vertex / Azure OpenAI | Bedrock GovCloud / Azure Gov |
| Key rotation | Manual | Automated by platform team | IAM role — no rotation needed |
| Appropriate for | Dev, prototypes | Enterprise production | Federal, DoD, regulated |
| Static key in `.env` | Yes | No | Never |

### Full env reference

```env
# ── LLM Provider ─────────────────────────────────────────────
# Tier 1:  anthropic | openai
# Tier 2:  bedrock | vertex | azure-openai
# Tier 3:  bedrock-gov | azure-gov | internal
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-4-6

# Tier 1 keys (dev only)
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Tier 2 — Bedrock
AWS_REGION=us-east-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6-v1

# Tier 2 — Vertex AI
VERTEX_PROJECT=your-gcp-project-id
VERTEX_LOCATION=us-central1
VERTEX_MODEL=claude-sonnet-4-6

# Tier 2 — Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=gpt-4o-prod
AZURE_OPENAI_API_VERSION=2024-08-01-preview

# Tier 3 — Bedrock GovCloud
# (same as Tier 2 Bedrock, region set to us-gov-*)
AWS_REGION=us-gov-west-1

# Tier 3 — Azure Government
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.us

# Tier 3 — Internal / 1P / research lab
INTERNAL_LLM_ENDPOINT=https://models.agency-internal.gov/v1
INTERNAL_LLM_MODEL=agency-llm-v2
INTERNAL_LLM_CERT_PATH=/run/secrets/client.crt
INTERNAL_LLM_KEY_PATH=/run/secrets/client.key

# ── Embeddings ───────────────────────────────────────────────
EMBEDDING_PROVIDER=openai         # or: cohere, voyage, bedrock, vertex
EMBEDDING_MODEL=text-embedding-3-small

# ── Vector Store (pick one) ──────────────────────────────────
VECTOR_STORE=chroma               # or: pinecone | pgvector | weaviate
CHROMA_URL=http://localhost:8000
PINECONE_API_KEY=...
PINECONE_INDEX=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
WEAVIATE_URL=...
WEAVIATE_API_KEY=...
# pgvector (Tier 2/3 — Aurora or self-hosted Postgres)
PGVECTOR_HOST=...
PGVECTOR_SSL=require

# ── Deployment Target ────────────────────────────────────────
DEPLOYMENT_TARGET=web             # or: slack | teams | widget | all

# ── Slack Bot ────────────────────────────────────────────────
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
SLACK_APP_TOKEN=xapp-...

# ── Teams Bot ────────────────────────────────────────────────
TEAMS_APP_ID=...
TEAMS_APP_PASSWORD=...

# ── App Config ───────────────────────────────────────────────
BOT_NAME="Aria"
BOT_PERSONA="You are a helpful assistant for Acme Corp. Answer only using the provided knowledge base."
MAX_TOKENS=1024
TEMPERATURE=0.2
TOP_K_RESULTS=10                  # Retrieve this many, rerank to TOP_K_AFTER_RERANK
TOP_K_AFTER_RERANK=5
CHUNK_SIZE=512
CHUNK_OVERLAP=64
HYBRID_SEARCH=false               # true = BM25 + semantic (recommended for federal)

# ── Response cache ───────────────────────────────────────────
CACHE_ENABLED=true
CACHE_TTL_SECONDS=86400
CACHE_SIMILARITY_THRESHOLD=0.93

# ── Accuracy guardrails ──────────────────────────────────────
MIN_RETRIEVAL_CONFIDENCE=0.70
FAITHFULNESS_CHECK=false          # true for high-stakes / regulated deployments
FAITHFULNESS_THRESHOLD=0.85

# ── Auth ─────────────────────────────────────────────────────
AUTH_ENABLED=false
AUTH_PROVIDER=clerk               # or: nextauth | saml (enterprise/federal)
CLERK_SECRET_KEY=...
SAML_ENTRY_POINT=...
SAML_ISSUER=rag-chat-agent
AUTH_RATE_LIMIT=50

# ── Session memory ───────────────────────────────────────────
SESSION_STORE=memory              # or: redis
UPSTASH_REDIS_URL=...
UPSTASH_REDIS_TOKEN=...
SESSION_MAX_TURNS=20

# ── PII redaction (enterprise / federal) ─────────────────────
PII_REDACTION_ENABLED=false       # true for any deployment handling personal data
PII_REDACTION_PROVIDER=presidio   # or: aws-comprehend

# ── Audit logging ────────────────────────────────────────────
AUDIT_LOG_ENABLED=false           # true for enterprise and federal
AUDIT_LOG_TARGET=console          # or: cloudwatch | s3 | splunk
AUDIT_LOG_RETENTION_DAYS=90
LOG_QUERY_HASHES=false            # true for federal — never log raw query text
LOG_RESPONSES=false               # responses may contain PII — off by default

# ── Federal mode (Tier 3 only) ───────────────────────────────
DEPLOYMENT_MODE=standard          # or: federal
IMPACT_LEVEL=low                  # low | moderate | high
DATA_CLASSIFICATION=public        # public | CUI | sensitive
A11Y_MODE=false                   # true enables WCAG 2.1 AA build + stream buffering
STREAM_BUFFER_MS=500
ENFORCE_DATA_RESIDENCY=false
ALLOWED_REGIONS=us-east-1,us-west-2
```

---

## Getting started

### Prerequisites

- Node.js 20+
- Docker (for local Chroma + Redis)
- **Two keys for the default path: an LLM key _and_ an embedding key.** The default config is Anthropic (LLM) + OpenAI (embeddings), so you need **both** `ANTHROPIC_API_KEY` **and** `OPENAI_API_KEY` — not either one. Anthropic has no first-party embeddings API, so the embedding key is separate. To avoid OpenAI entirely, set `EMBEDDING_PROVIDER=voyage` (or `cohere`) and supply that provider's key instead.

### 1. Clone and install

```bash
git clone https://github.com/your-org/rag-chat-agent
cd rag-chat-agent
npm install
```

### 2. Configure

```bash
cp .env.example .env.local
# Fill in your API keys and preferred providers
```

Put your keys in a **repo-root `.env.local`** (not inside `apps/web/`). The root `.env.local` (then `.env`) is now loaded for **both** the web app and the CLIs (`npm run ingest` / `npm run seed`) from a single seam, so the same file works everywhere. Real shell / secrets-manager values still take precedence over the file. For the default path you need both an LLM key and an embedding key — see [Prerequisites](#prerequisites).

### 3. Start local services

```bash
docker compose -f docker/docker-compose.yml up -d
# Starts Chroma (port 8000) and Redis (port 6379)
```

### 4. Ingest your knowledge base

```bash
# Ingest a folder of PDFs and Markdown files
npm run ingest -- --source ./docs --type pdf,md --namespace acme-corp

# Or ingest from a URL
npm run ingest -- --source https://yoursite.com/docs --type url --namespace acme-corp
```

#### Or: try the bundled demo knowledge bases

Want to kick the tires before wiring your own docs? `npm run seed` ingests four
ready-made corpora, each into its **own namespace** — which doubles as a live demo of
the kit's tenant isolation (the same pipeline answers only from the corpus you select):

| Namespace | Knowledge base | Try asking |
|---|---|---|
| `default` | Support desk | *"What is the refund window?"* |
| `bread` | Home breadmaking | *"Why is my crumb dense?"* · *"What is autolyse?"* |
| `meds` | OTC medication reference | *"What is the generic name of Tylenol?"* · *"Is Pepcid a PPI?"* |
| `pubsec` | Citizen-services FAQ | *"How do I renew my passport?"* · *"What is REAL ID?"* |

```bash
npm run seed                 # seed all four corpora
npm run seed -- --only bread # or just one (default | bread | meds | pubsec)
```

In the web app, switch corpora with the **Knowledge base** dropdown at the top. Ask
something outside the selected corpus (e.g. *"what's the capital of France?"* in the
bread KB) to watch the **low-confidence fallback** decline instead of hallucinate.

The `meds` and `pubsec` corpora are deliberately high-stakes — they carry "not advice,
verify with a professional / official source" disclaimers, which makes them a good way
to see the citation, confidence-gate, and escalation guardrails earn their keep. The
medication data is an educational **generic↔brand reference with no dosing** (see
[`scripts/seed-data/meds/`](scripts/seed-data/meds/)); the citizen-services data is
illustrative sample content, not official guidance.

#### Governance: the demo corpora run at different levels of control

The same pipeline serves all four corpora — but each namespace runs under its own
**policy**, so the *governance posture* matches the *sensitivity* of the content. This is
the kit's per-tenant governance lever, and it's what makes "open for bread, locked-down
for meds" real rather than just a promise:

| Corpus | Posture | Persona | Confidence gate | Strict grounding | Faithfulness |
|---|---|---|---|---|---|
| `bread` | **Open / free-flow** | warm, recommends freely | low (0.55) | off | off |
| `pubsec` | **Moderate** | cites the FAQ, "verify with the official agency" | 0.70 | on | off |
| `meds` | **Guardrailed** | refuses dosing/diagnosis/personal picks; always cites | high (0.80) | on | on |
| `default` | base settings | global `BOT_PERSONA` | global | global | global |

So the **bread** bot chats loosely and suggests freely (low stakes), while the **meds**
bot answers only when retrieval is strongly relevant, escalates anything it can't ground
in a citation, runs the extra faithfulness check, and is personally instructed to decline
doses, diagnoses, and "what should I take" — deferring to a pharmacist. Same engine, two
very different risk postures.

These postures ship as built-in defaults (`DEMO_NAMESPACE_POLICIES`), so the difference
shows out of the box with no config. Set your own per-namespace policies — persona plus
the guardrail knobs (`minConfidence`, `strictGrounding`, `faithfulnessCheck`,
`faithfulnessThreshold`) — via the `NAMESPACE_POLICIES` env var (JSON keyed by namespace;
merged over the defaults). It's the right place to encode "this tenant's data is
sensitive, dial the guardrails up." Anything you don't override falls back to the global
settings.

### 5. Run the app

```bash
# Web interface
npm run dev --workspace=apps/web

# Slack bot
npm run dev --workspace=apps/bot -- --target=slack

# Embeddable widget server
npm run dev --workspace=apps/widget
```

---

## Deployment targets

### Web app

The `apps/web` package is a full Next.js App Router project with:
- Streaming chat UI — the app streams **ndjson over a hand-rolled `ReadableStream`** (no Vercel AI SDK); the client decodes it line by line
- Conversation history
- Source citations on each answer
- Optional auth — a pluggable, secure-by-default gate (Clerk / NextAuth / SAML are integration options, not the default; see [`CONFIG.md#auth`](CONFIG.md#auth))

Deploy to Vercel in one command:
```bash
npx vercel --prod
```

### Slack bot

The `apps/bot` package includes a Bolt.js Slack adapter. The bot:
- Responds in DMs and @mentions in channels
- Keeps a per-thread conversation window
- Formats responses with Slack Block Kit

Deploy to Railway or Fly.io with the included Dockerfile.

### Teams bot

Same `apps/bot` package, Teams adapter. Uses Azure Bot Framework. Responds in personal chat and channel mentions.

### Embeddable widget

The `apps/widget` package builds a self-contained `<script>` tag you drop into any website:

```html
<script
  src="https://your-api.com/widget.js"
  data-api-url="https://your-api.com"
  data-bot-name="Aria"
  data-primary-color="#0066FF"
  data-position="bottom-right"
  data-mode="bubble"
></script>
```

Customisable via `data-*` attributes (see `apps/widget/src/loader.ts`):
- `data-api-url` — API origin (defaults to the script's own origin)
- `data-bot-name` — bot display name (defaults to `Assistant`)
- `data-primary-color` — launcher / accent color (defaults to `#1d4ed8`)
- `data-position` — `bottom-right` (default) or `bottom-left`
- `data-mode` — `bubble` (floating launcher, default) or `inline` (renders in place)
- Iframe-sandboxed for safety on any host site; which host pages may embed it is enforced server-side via a CSP `frame-ancestors` header keyed off `WIDGET_ALLOWED_ORIGINS`

---

## RAG pipeline

The pipeline in `packages/rag-core` follows the current production best practice pattern:

```
User query
  → Query rewrite (LLM, optional — improves retrieval on vague queries)
  → Embed query (embedding model)
  → Semantic search (vector store, top-K results)
  → Rerank (cross-encoder — filters noise before generation)
  → Build context window (chunks + metadata + conversation history)
  → Generate response (LLM, streamed)
  → Return response + source citations
```

Key design decisions (backed by current enterprise patterns):
- **Reranker included by default.** Initial retrieval casts wide; reranker refines. This combination consistently outperforms naive top-K alone.
- **Hybrid retrieval optional.** A keyword search layer (BM25) can be layered on top of semantic search for domains with lots of exact-match terminology. Toggle via `HYBRID_SEARCH=true`.
- **Conversation memory is bounded.** `SESSION_MAX_TURNS` prevents context window blowout on long conversations. Older turns are summarised, not dropped.
- **Source citations always returned.** Every response includes the chunk source and page number (if available). Clients surface this in the UI.

---

## Ingestion pipeline

The `packages/ingestion` package supports:

| Source type | Notes |
|---|---|
| PDF | Text extraction + table detection |
| Markdown / MDX | Preserves heading structure in metadata |
| DOCX | Headings and paragraphs |
| Plain text | Any `.txt` file |
| URL | Crawls a single page (Cheerio) |
| Sitemap | Crawls all pages listed in `sitemap.xml` |
| Notion | Via Notion API (requires integration token) |
| Confluence | Via Confluence REST API |

Chunking strategy: recursive text splitting with semantic boundary awareness. Chunk size and overlap are configurable per ingest run.

---

## Security and access control

Following current enterprise deployment patterns:

- **Authentication** — a pluggable, **secure-by-default** gate. With `AUTH_ENABLED=true` and no verifier configured, the API **fails closed** (rejects every request). Wire a real verifier with `setTokenVerifier(...)` (Clerk / NextAuth / JWKS / SAML), use the built-in `AUTH_STATIC_TOKENS`, or — local dev only — `AUTH_ALLOW_INSECURE_TOKENS`. See [`CONFIG.md#auth`](CONFIG.md#auth).
- **Rate limiting** — per-user or per-IP rate limiting on the `/api/chat` endpoint. Configurable via `AUTH_RATE_LIMIT`.
- **Tenant → namespace isolation** — a verified identity carries which namespaces it may use; a caller can never read another tenant's data by passing an arbitrary namespace. `/api/ingest` additionally requires an **admin** identity.
- **API key management** — all secrets via environment variables only. Never committed to the repo.
- **CORS** — widget server enforces an allowlist of host domains via `WIDGET_ALLOWED_ORIGINS`.
- **Prompt injection hardening** — system prompt is server-controlled and not user-modifiable. User input is sanitised before concatenation.

---

## Customisation guide

### Swapping the LLM

Change two env vars:
```env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
```
No code changes. The `packages/llm-adapters` package normalises the provider interface.

### Swapping the vector store

Change one env var and supply the relevant credentials:
```env
VECTOR_STORE=pinecone
PINECONE_API_KEY=...
PINECONE_INDEX=my-index
```

### Customising the bot persona

Edit `BOT_PERSONA` in your `.env.local`. This becomes the system prompt. Keep it focused on the use case — a narrowly scoped persona reduces hallucination.

### Adding a new document source

Implement the `DocumentLoader` interface in `packages/ingestion/src/loaders/`:
```typescript
export interface DocumentLoader {
  load(): Promise<Document[]>
}
```
Then register it in `packages/ingestion/src/index.ts`.

### Styling the web app

The UI components use **inline styles + CSS custom properties** — there is no Tailwind or shadcn/ui, and no `tailwind.config.ts`. Restyle by passing a `theme` prop to the chat UI components in `packages/ui-components`, which sets the CSS custom properties the components read.

---

## What agencies/businesses should customise first

Based on how teams are shipping production RAG agents in 2025–2026, these are the high-ROI changes:

1. **Bot persona** — set a tight scope. "Answer only using the knowledge base. If unsure, say so." Prevents hallucination on questions outside the docs.
2. **Chunk size** — tune this for your content. API docs and FAQs chunk well at 256–512 tokens. Long-form PDFs do better at 1024.
3. **Top-K and reranker** — start with `TOP_K_RESULTS=10` and rerank to 5. Adjust based on answer quality.
4. **Source citations UI** — leave them on. Enterprise users trust answers more when sources are visible.
5. **Rate limiting** — set this before going to production. Default is 50 req/min per user.
6. **Auth** — enable it for internal tools. Optional for public-facing widgets.

---

---

## Federal deployment (FedRAMP + Section 508)

> Everything in this section lives in the `/federal` directory. It is opt-in. Commercial deployments are not affected.

This is a **federal-oriented template / starting point — not a FedRAMP-authorized or "compliant" product**. It re-routes dependencies inside the authorization boundary and ships the controls and compliance-document templates a federal system needs, but it **still requires your own ATO and an independent 3PAO (or agency-designated) assessment**. Federal agencies and GovTech contractors operating under FedRAMP requirements cannot use the standard commercial configuration out of the box: the infrastructure, LLM access paths, vector store, auth, logging, and UI all need to change. This section documents what changes and why.

### What changes

| Component | Commercial default | Federal replacement | Why |
|---|---|---|---|
| LLM access | Direct Anthropic / OpenAI API | AWS Bedrock GovCloud (Claude) or Azure Gov (OpenAI) | Commercial API endpoints are outside the FedRAMP authorization boundary |
| Vector store | Chroma or Pinecone | pgvector on AWS Aurora GovCloud | Pinecone has no FedRAMP authorization; Chroma is local-only |
| Deployment | Vercel / Railway | AWS GovCloud ECS or Azure Government App Service | Must run inside the FedRAMP boundary |
| Session store | Upstash Redis | AWS ElastiCache GovCloud | Data residency — must remain CONUS |
| Auth | Clerk / JWT | SAML 2.0 (PIV / CAC card) | Agencies use federated identity; Clerk is not in boundary |
| API credentials | Static API keys in `.env` | IAM role-based access (workload identity) | Static keys are a NIST 800-53 violation at High impact level |
| Analytics | Mixpanel / Segment | None, or agency-approved SIEM | Third-party analytics tools are outside the boundary |

### LLM access via GovCloud

You cannot call `api.anthropic.com` or `api.openai.com` directly from a federal deployment. All calls must route through the authorized cloud boundary:

```env
# Claude via AWS Bedrock GovCloud (FedRAMP High)
LLM_PROVIDER=bedrock-gov
AWS_REGION=us-gov-west-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6-v1
# No static API key — IAM role assumed at runtime

# OpenAI via Azure Government (FedRAMP Moderate)
LLM_PROVIDER=azure-gov
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.us
AZURE_OPENAI_DEPLOYMENT=gpt-4o
```

This is not just a URL swap. You need to provision model deployments in the GovCloud console, configure workload identity federation, and handle differences in the API surface between commercial and government endpoints. The `/federal/infra/terraform-govcloud` directory provides Terraform modules for this.

### Impact levels

Match your deployment to the right authorization level before selecting a provider:

- **Low** — public-facing informational tools, no PII or sensitive data
- **Moderate** — most civilian agency internal tools; covered by OpenAI FedRAMP Moderate
- **High** — systems handling CUI, law enforcement, or health data; requires Claude FedRAMP High via Bedrock GovCloud

### Section 508 compliance

Section 508 requires WCAG 2.0 Level AA as the legal baseline. This repo targets WCAG 2.1 Level AA — the level agencies are actively requesting even though 2.1 is not yet codified in the Revised 508 Standards.

Key requirements for a chat interface:

**Keyboard navigation.** Every action — sending a message, reading source citations, triggering feedback — must be fully operable via keyboard. Tab order must be logical. Focus must never be trapped inside the chat window.

**Screen reader support.** The message list uses `role="log"` with `aria-live="polite"` so new messages are announced without hijacking focus. The typing indicator uses `role="status"`. Source citations are labelled descriptively (`"Source 1: returns policy, page 2"`) rather than just `[1]`.

**Streaming and screen readers.** Token-by-token streaming is inaccessible to screen readers — text changing 10 times per second cannot be tracked. The solution is announcement buffering: the stream renders visually in real time, but the `aria-live` region only announces complete sentences. Configure via `STREAM_BUFFER_MS=500`.

**Colour contrast.** All text meets 4.5:1 contrast ratio. Status indicators (error, success, escalation) always include a text or icon label in addition to colour — never colour alone.

**Text resize.** The layout does not break at 200% browser zoom. No fixed-pixel heights on message containers.

**VPAT.** A pre-filled Voluntary Product Accessibility Template is provided in `/federal/compliance/VPAT.md`. Most federal procurements require this before a contract award. Update it whenever the UI changes.

### ATO and compliance documents

This repo ships with templates — not approvals. An Authority to Operate requires an independent assessor and sign-off from the agency ISSO. What's included to reduce preparation time:

- `federal/compliance/SSP-template.md` — System Security Plan with sections pre-populated for this architecture
- `federal/compliance/controls-matrix.md` — NIST 800-53 Rev 5 controls mapped to inherited (cloud provider) vs agency-owned
- `federal/compliance/IR-runbook.md` — Incident response procedures for data breach, prompt injection, unauthorized access, and outage
- `federal/compliance/VPAT.md` — Accessibility conformance report

Templates accelerate the process. They do not replace the process.

### Federal env config

```env
# /federal/.env.federal.example

# ── Mode ─────────────────────────────────────────────
DEPLOYMENT_MODE=federal
IMPACT_LEVEL=high                    # low | moderate | high
DATA_CLASSIFICATION=CUI

# ── LLM via GovCloud ─────────────────────────────────
LLM_PROVIDER=bedrock-gov
AWS_REGION=us-gov-west-1
AWS_BEDROCK_MODEL=anthropic.claude-sonnet-4-6-v1

# ── Vector store ─────────────────────────────────────
VECTOR_STORE=pgvector
PGVECTOR_HOST=*.us-gov-west-1.rds.amazonaws.com
PGVECTOR_SSL=require

# ── PII redaction ────────────────────────────────────
PII_REDACTION_ENABLED=true
PII_REDACTION_PROVIDER=aws-comprehend

# ── Audit logging (NIST 800-53 AU-2, AU-12) ─────────
AUDIT_LOG_ENABLED=true
AUDIT_LOG_TARGET=cloudwatch
AUDIT_LOG_RETENTION_DAYS=1095        # 3 years
LOG_QUERY_HASHES=true                # never store raw query text
LOG_RESPONSES=false                  # responses may contain PII

# ── Auth ─────────────────────────────────────────────
AUTH_ENABLED=true
AUTH_PROVIDER=saml
SAML_ENTRY_POINT=https://agency-idp.gov/sso
SAML_ISSUER=rag-chat-agent

# ── 508 accessibility ────────────────────────────────
A11Y_MODE=true
STREAM_BUFFER_MS=500

# ── Data residency ───────────────────────────────────
ALLOWED_REGIONS=us-gov-west-1,us-gov-east-1
ENFORCE_DATA_RESIDENCY=true
```

---

## Lifecycle and maintenance

**This section is not optional reading.** A RAG chatbot is not a website you launch and leave. It is a live system built on a knowledge base that goes stale, a model that gets updated, and a user population whose questions evolve. Agencies that treat this as a one-time deployment end up with a bot that confidently answers from outdated policy documents, misses questions on topics that were never ingested, and drifts out of accessibility compliance as the UI gets patched.

The following is what ongoing ownership actually looks like.

### Knowledge base maintenance

The knowledge base is the most important thing to maintain and the most commonly neglected.

**Document freshness.** Every source document in the knowledge base has an effective date. When policy documents are updated, superseded guidance is deprecated, or new regulations are published, the corresponding chunks in the vector store must be updated. Stale chunks produce confidently wrong answers — the bot has no way to know a document is outdated unless you tell it.

Assign a document owner for every ingested source. That owner is responsible for triggering a re-ingest when the source changes. The `scripts/ingest.ts` CLI accepts a `--namespace` flag so individual document sets can be updated without re-ingesting the entire knowledge base.

**Knowledge gap detection.** The `scripts/knowledge-health.ts` CLI scans your query logs for questions that hit the low-confidence fallback — these are questions users are asking that your knowledge base cannot answer. Run it weekly. The output is a prioritised list of content gaps to fill.

```bash
# Run weekly — outputs a gap report to ./reports/knowledge-gaps-YYYY-MM-DD.md
npm run knowledge-health -- --days 7 --output ./reports
```

**Coverage review cadence.** Recommended schedule by agency type:

| Agency type | Full re-review cadence | Trigger-based re-ingest |
|---|---|---|
| Regulatory / policy-heavy | Monthly | On every policy update |
| Internal HR / IT helpdesk | Quarterly | On every handbook revision |
| Public-facing constituent service | Bi-monthly | On every web content update |

### Model and dependency maintenance

**LLM provider updates.** When your LLM provider releases a new model version, test it against your existing eval suite before switching. A model that is smarter on general benchmarks is not necessarily better on your specific domain. The `CACHE_INVALIDATE_ON_MODEL_CHANGE=true` flag auto-clears the response cache when `LLM_MODEL` changes, preventing old-model responses from being served under a new model.

**Embedding model changes.** Changing the embedding model is more disruptive than changing the LLM. The new model produces different vectors, so every document in the vector store must be re-embedded from scratch. Plan for this to take hours for large knowledge bases. Schedule it as a maintenance window.

**Dependency updates.** The vector store SDKs and the LLM provider SDKs all ship breaking changes. Pin your dependencies in `package.json` and review updates on a monthly cadence rather than accepting automatic upgrades in production.

### Accuracy monitoring

Answer quality degrades silently if you are not measuring it. The following signals must be monitored continuously:

**Retrieval confidence trend.** The average top-chunk similarity score across all queries should stay relatively stable. A declining trend means the knowledge base is drifting from what users are asking — new question topics are emerging that the ingested docs do not cover.

**Escalation rate.** The percentage of queries that hit the low-confidence fallback and are flagged for human review. A sudden spike indicates either a knowledge base gap or a prompt injection attempt. A slow upward trend indicates coverage drift.

**Negative feedback rate.** Thumbs-down signals from users. Every piece of negative feedback is stored with the full retrieval context so you can debug exactly why the answer was wrong.

**Cache hit rate.** A dropping cache hit rate after a stable period can indicate that user question patterns are shifting — useful signal for knowledge base planning.

Set up a weekly review of these four metrics. For federal deployments, this review should be documented and retained as part of continuous monitoring under the ATO.

### Security maintenance

**Dependency vulnerability scanning.** Run `npm audit` in CI on every pull request. For federal deployments, use the agency-approved SAST/DAST tooling in addition to npm audit.

**Prompt injection monitoring.** Review the audit logs weekly for patterns that look like injection attempts — unusual instruction-like text in user queries, attempts to override the system persona, or queries referencing the system prompt by name.

**Access review.** Quarterly: review which users and roles have access to the ingestion pipeline. The ability to add documents to the knowledge base is a privileged operation — someone with malicious intent could poison the knowledge base with false information. Treat ingest access like write access to a production database.

**FedRAMP continuous monitoring (federal only).** FedRAMP authorization is not a one-time event. It requires monthly vulnerability scanning, annual penetration testing, and ongoing Plan of Action and Milestones (POA&M) tracking for any identified weaknesses. The `/federal/compliance/controls-matrix.md` maps which controls require continuous evidence collection.

### 508 compliance maintenance (federal only)

Accessibility compliance is not a one-time audit — it degrades as the UI evolves. Every UI change must be tested against the WCAG 2.1 AA criteria before deployment. The recommended process:

1. Automated scan on every PR — axe-core or similar integrated into CI
2. Manual keyboard navigation test before every release
3. Screen reader test (NVDA + Chrome, VoiceOver + Safari) monthly
4. Full VPAT review any time a new UI component is added or a core interaction changes

### Suggested maintenance schedule

| Frequency | Task |
|---|---|
| On every doc update | Re-ingest updated documents; cache auto-invalidates |
| Weekly | Review knowledge gap report; review escalation rate and negative feedback |
| Monthly | Dependency updates; prompt injection log review; 508 automated scan |
| Quarterly | Full knowledge base coverage review; access review; embedding model evaluation |
| Annually | Full security assessment; VPAT review and re-publication (federal); ATO renewal prep (federal) |
| On model change | Full eval suite run before switching; re-ingest if embedding model changes |

---

## Roadmap (post-MVP)

**Core**
- [ ] Analytics dashboard — track query topics, resolution rate, escalations, cache hit rate
- [ ] Admin UI — manage documents, re-ingest, review conversations, assign document owners
- [ ] Knowledge health dashboard — visual gap report, coverage trends, stale document alerts
- [ ] Multi-language support — automatic language detection + response in user's language
- [ ] Voice input — Web Speech API integration for the web app
- [ ] Agentic mode — let the bot take actions (open tickets, look up CRM data) beyond answering questions
- [ ] A/B testing — compare prompts and models against real conversations
- [ ] Fine-tuning pipeline — export high-quality Q/A pairs for downstream fine-tuning

**Federal tier**
- [ ] FedRAMP IL5 config — Azure Government IL5 boundary support for DoD use cases
- [ ] PIV / CAC card auth — hardware token authentication for high-assurance environments
- [ ] POA&M tracker — Plan of Action and Milestones tracking integrated with the audit log
- [ ] Automated 508 CI — axe-core integrated into the PR pipeline with blocking thresholds
- [ ] Multilingual 508 — accessible UI in Spanish and other languages per agency mandate

---

## Contributing

PRs welcome. Open an issue before starting major work so we can align on direction.

```bash
# Run all tests
npm run test

# Type check
npm run typecheck

# Lint
npm run lint
```

---

## License

MIT — fork it, ship it, sell it. Attribution appreciated but not required.
