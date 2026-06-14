# RAG Chat Agent — Coding Harness Prompt

> Copy this prompt in full into Claude Code, Codex, or any agentic coding harness to begin scaffolding the repo. It contains all architectural decisions, interfaces, constraints, and build order already resolved. Do not re-litigate design decisions mid-build — they are intentional. If you want to change something, do it here before starting.

---

## Your role

You are building a production-ready, open-source RAG chatbot boilerplate called `rag-chat-agent`. This is not a demo or a tutorial project. It is a starting point that agencies, enterprises, and developers take, configure, and own. Every file you create should be production-quality, well-commented, and built to be extended — not thrown away.

The repo's primary purpose is to show people what a production RAG system actually requires. Code quality, comments, and structure carry that message as much as the README does. Write code that a senior engineer would be comfortable handing to a client.

---

## Non-negotiable constraints

Read these before writing a single line of code. They are architectural decisions that have already been made.

1. **Everything is config-driven.** No provider, deployment target, or credential mode should require a code change to switch. All variation lives in environment variables. The adapter pattern enforces this — every external dependency (LLM, vector store, embedding model, auth, session store) goes through a typed interface with multiple implementations.

2. **Three credential tiers must work without code changes:**
   - Tier 1 (dev): direct API key in `.env.local`
   - Tier 2 (enterprise): IAM role / Managed Identity / workload identity federation via Bedrock, Vertex AI, or Azure OpenAI
   - Tier 3 (federal): GovCloud-only endpoints, zero static secrets, IAM role assumed at runtime

3. **The federal deployment tier is opt-in, not a fork.** `DEPLOYMENT_MODE=federal` activates federal middleware (GovCloud routing, PII redaction, NIST audit logging, SAML auth, 508 UI mode). Commercial deployments are entirely unaffected.

4. **TypeScript everywhere.** Strict mode. No `any`. Interfaces before implementations. Export types alongside every module.

5. **Accuracy guardrails are not optional features.** They are part of the core pipeline. The system prompt lock, retrieval confidence threshold, citation enforcement, and cache grounding check must be implemented as first-class pipeline stages — not bolted on later.

6. **The response cache validates source grounding on every hit.** A cache hit must verify that the source chunks it was built from still exist and still match their stored content hash. If they don't, the entry is invalidated and the full pipeline re-runs.

7. **WCAG 2.1 AA is the accessibility baseline.** All shared UI components must be keyboard-navigable, screen-reader-announced, and contrast-compliant. The `A11Y_MODE=true` flag enables the federal-specific accessibility build (ARIA live regions, stream buffering for screen readers).

8. **No third-party analytics, tracking, or telemetry.** This repo is deployed in environments where data must stay within a defined boundary.

9. **Comments are mandatory on every non-trivial function.** The audience for this repo includes people learning how production RAG works. Comments should explain the *why*, not just the *what*.

---

## Monorepo structure

Use **Turborepo** with npm workspaces. Do not use Yarn or pnpm — npm is the lowest common denominator for the target audience.

```
rag-chat-agent/
├── apps/
│   ├── web/                      # Next.js 14 App Router chat UI
│   ├── widget/                   # Embeddable <script> widget
│   └── bot/                      # Slack + Teams bot adapters
├── packages/
│   ├── rag-core/                 # Pipeline, retriever, reranker, cache, guardrails
│   ├── vector-adapters/          # Chroma, Pinecone, pgvector, Weaviate
│   ├── llm-adapters/             # Anthropic, OpenAI, Bedrock, Vertex, Azure, internal
│   ├── ingestion/                # Document loaders, chunker, PII redactor
│   ├── ui-components/            # Shared ARIA-annotated React chat components
│   └── audit-logger/             # NIST 800-53-format structured log emitter
├── federal/
│   ├── .env.federal.example
│   ├── FEDERAL.md
│   ├── compliance/
│   │   ├── VPAT.md
│   │   ├── SSP-template.md
│   │   ├── controls-matrix.md
│   │   └── IR-runbook.md
│   └── infra/
│       ├── terraform-govcloud/   # AWS GovCloud IaC
│       └── azure-gov/            # Azure Government ARM templates
├── scripts/
│   ├── ingest.ts
│   ├── seed.ts
│   ├── audit-report.ts
│   └── knowledge-health.ts
├── docker/
│   ├── docker-compose.yml        # Chroma + Redis for local dev
│   └── Dockerfile
├── .env.example
├── .env.federal.example          # symlink to federal/.env.federal.example
├── turbo.json
├── package.json                  # root workspace
├── tsconfig.base.json
├── CONFIG.md
├── MAINTENANCE.md
└── README.md
```

---

## Build order

Build in this exact order. Each phase must be complete and type-checking before moving to the next. Do not scaffold everything at once and fill in later — build working layers.

### Phase 1 — Monorepo skeleton

1. Root `package.json` with workspaces defined
2. `turbo.json` with `build`, `dev`, `test`, `lint`, `typecheck` pipelines
3. `tsconfig.base.json` — strict mode, `moduleResolution: bundler`, path aliases
4. Each package and app gets its own `package.json` and `tsconfig.json` extending base
5. Root `.env.example` fully populated with every env var documented inline
6. Root `README.md` — use the content from the project README provided separately

### Phase 2 — Core interfaces (packages only, no implementations yet)

Define the TypeScript interfaces that every adapter must implement. These are the contracts everything else is built against.

```typescript
// packages/llm-adapters/src/types.ts
export interface LLMAdapter {
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>
  stream(messages: ChatMessage[], options: ChatOptions): AsyncGenerator<string>
  readonly provider: string
  readonly model: string
}

// packages/vector-adapters/src/types.ts
export interface VectorAdapter {
  search(embedding: number[], topK: number, filter?: MetadataFilter): Promise<SearchResult[]>
  upsert(chunks: EmbeddedChunk[]): Promise<void>
  delete(ids: string[]): Promise<void>
  getById(id: string): Promise<StoredChunk | null>
  namespace(ns: string): VectorAdapter
}

// packages/rag-core/src/types.ts
export interface RAGPipeline {
  query(input: QueryInput): Promise<RAGResponse>
  stream(input: QueryInput): AsyncGenerator<StreamChunk>
}

export interface ResponseCache {
  get(embedding: number[], namespace: string): Promise<CachedResponse | null>
  set(embedding: number[], namespace: string, response: CachedResponse, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
  invalidate(namespace: string): Promise<void>
}

export interface DocumentLoader {
  load(): Promise<Document[]>
  readonly sourceType: string
}

// packages/audit-logger/src/types.ts
export interface AuditLogger {
  logQuery(event: QueryEvent): void
  logIngest(event: IngestEvent): void
  logCacheEvent(event: CacheEvent): void
  logSecurityEvent(event: SecurityEvent): void
}
```

Export every type from the package root. Downstream consumers import from the package name, never from internal paths.

### Phase 3 — packages/audit-logger

Build this first because everything else depends on it for observability.

**What it does:** Emits structured log events in NIST 800-53-compatible format. In standard mode, logs to stdout as JSON. In federal mode (`AUDIT_LOG_TARGET=cloudwatch|s3|splunk`), emits to the configured target.

**Key requirements:**
- Never log raw query text. Log `sha256(query)` when `LOG_QUERY_HASHES=true`
- Never log response text when `LOG_RESPONSES=false`
- Every event must include: `timestamp` (ISO 8601), `event_type`, `session_id`, `user_id` (if auth enabled), `latency_ms`, and event-specific fields
- The logger must be a singleton initialised once from env vars and imported anywhere
- Provide a no-op logger for test environments

```typescript
// Minimum event shape — extend per event type
interface BaseAuditEvent {
  timestamp: string        // ISO 8601
  event_type: string
  session_id: string
  user_id?: string
  latency_ms: number
  environment: string      // process.env.NODE_ENV
  deployment_mode: string  // standard | federal
}
```

### Phase 4 — packages/llm-adapters

Implement all six LLM providers behind the `LLMAdapter` interface.

**Providers to implement:**

| Export name | Provider | When used |
|---|---|---|
| `AnthropicAdapter` | Direct Anthropic API | Tier 1 dev |
| `OpenAIAdapter` | Direct OpenAI API | Tier 1 dev |
| `BedrockAdapter` | AWS Bedrock | Tier 2 enterprise |
| `VertexAdapter` | Google Vertex AI | Tier 2 enterprise |
| `AzureOpenAIAdapter` | Azure OpenAI Service | Tier 2 enterprise |
| `BedrockGovAdapter` | AWS Bedrock GovCloud | Tier 3 federal |
| `AzureGovAdapter` | Azure Government | Tier 3 federal |
| `InternalAdapter` | Agency 1P / research lab | Tier 3 federal |

**Factory function — this is the primary consumer API:**

```typescript
// packages/llm-adapters/src/index.ts
export function createLLMAdapter(env: Env): LLMAdapter {
  switch (env.LLM_PROVIDER) {
    case 'anthropic':    return new AnthropicAdapter(env)
    case 'openai':       return new OpenAIAdapter(env)
    case 'bedrock':      return new BedrockAdapter(env)
    case 'vertex':       return new VertexAdapter(env)
    case 'azure-openai': return new AzureOpenAIAdapter(env)
    case 'bedrock-gov':  return new BedrockGovAdapter(env)
    case 'azure-gov':    return new AzureGovAdapter(env)
    case 'internal':     return new InternalAdapter(env)
    default: throw new Error(`Unknown LLM_PROVIDER: ${env.LLM_PROVIDER}`)
  }
}
```

**Bedrock and GovCloud auth:** Must use `@aws-sdk/client-bedrock-runtime` with credential resolution from the default credential provider chain — never accept a static key. In CI/local dev, credentials come from `aws sso login`. In production, from the IAM task role.

**InternalAdapter:** Expects an OpenAI-compatible `/v1/chat/completions` endpoint. Auth via mTLS — reads cert/key from `INTERNAL_LLM_CERT_PATH` and `INTERNAL_LLM_KEY_PATH`. Must handle self-signed certificates in agency environments.

**Streaming:** All adapters must implement `stream()` as an async generator yielding string tokens. The web app and widget use streaming. Non-streaming `chat()` is for internal pipeline calls (query rewrite, faithfulness scoring).

### Phase 5 — packages/vector-adapters

Implement all four vector stores behind the `VectorAdapter` interface.

**Adapters to implement:** `ChromaAdapter`, `PineconeAdapter`, `PgVectorAdapter`, `WeaviateAdapter`

**Factory function:**
```typescript
export function createVectorAdapter(env: Env): VectorAdapter {
  switch (env.VECTOR_STORE) {
    case 'chroma':   return new ChromaAdapter(env)
    case 'pinecone': return new PineconeAdapter(env)
    case 'pgvector': return new PgVectorAdapter(env)
    case 'weaviate': return new WeaviateAdapter(env)
    default: throw new Error(`Unknown VECTOR_STORE: ${env.VECTOR_STORE}`)
  }
}
```

**PgVectorAdapter specifics:**
- Use `pg` client with `pgvector` extension
- SSL must be enforced when `PGVECTOR_SSL=require` — reject connections without it
- Connection pool, not single connection
- The `getById` method must be implemented for the cache grounding check — this is not optional

**Content hashing for cache grounding:**
Every stored chunk must include a `contentHash: string` field — `sha256` of the chunk text. The cache grounding check compares this hash against the stored hash in the cache entry to detect if the source has changed.

**Namespace support:** All adapters must support `.namespace(ns: string)` — returns a scoped adapter that prefixes all operations with the namespace. Used for multi-tenant isolation and federal role-based access control.

### Phase 6 — packages/ingestion

Document loaders, chunker, and PII redactor.

**Loaders to implement:**

```typescript
// Each implements DocumentLoader
PdfLoader         // uses pdf-parse
MarkdownLoader    // preserves heading structure in metadata
DocxLoader        // uses mammoth
TextLoader        // plain .txt
UrlLoader         // uses cheerio, single page
SitemapLoader     // crawls all URLs in sitemap.xml
NotionLoader      // Notion API — requires NOTION_TOKEN
ConfluenceLoader  // Confluence REST API — requires CONFLUENCE credentials
```

**Chunker:**
Use recursive text splitting with semantic boundary awareness. Respect heading structure in Markdown — never split mid-heading. Store the following metadata on every chunk:

```typescript
interface ChunkMetadata {
  sourceFile: string       // original file path or URL
  sourceType: string       // pdf | md | docx | url | notion | confluence
  chunkIndex: number       // position within source
  pageNumber?: number      // for PDFs
  heading?: string         // nearest parent heading (for Markdown/DOCX)
  contentHash: string      // sha256 of chunk text — used by cache grounding
  ingestedAt: string       // ISO 8601
  namespace: string        // which namespace this belongs to
}
```

**PII redactor:**
Runs on chunk text before embedding when `PII_REDACTION_ENABLED=true`.

```typescript
interface PIIRedactor {
  redact(text: string): Promise<RedactedText>
}

// Two implementations:
class PresidioRedactor implements PIIRedactor  // local, open-source
class ComprehendRedactor implements PIIRedactor // AWS Comprehend (GovCloud-compatible)
```

Entities to detect and replace: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `SSN`, `DATE_OF_BIRTH`, `STREET_ADDRESS`, `CREDIT_CARD`. Replace with labelled placeholders: `[REDACTED_PERSON]`, `[REDACTED_SSN]`, etc.

**Ingest CLI (`scripts/ingest.ts`):**
```bash
npx ts-node scripts/ingest.ts \
  --source ./docs \
  --type pdf,md \
  --namespace acme-corp \
  --chunk-size 512 \
  --chunk-overlap 64

# On completion, automatically:
# 1. Logs ingest event to audit logger
# 2. Calls cache.invalidate(namespace)
# 3. Outputs a summary: N files, M chunks, P tokens
```

### Phase 7 — packages/rag-core

This is the heart of the repo. Build it carefully.

**Pipeline stages — implement in this order:**

```
1. Sanitise input         → strip prompt injection patterns
2. Load session history   → from session store (Redis or in-memory)
3. Query rewrite          → optional LLM call to clean up the query
4. Embed query            → embedding model call
5. Cache check            → semantic similarity search in cache
   └── Hit: grounding check → verify source chunks still match
       └── Pass: return cached response
       └── Fail: invalidate, continue to retrieval
6. Retrieve               → vector store search, top-K
7. Confidence check       → if best score < MIN_RETRIEVAL_CONFIDENCE → return fallback
8. Rerank                 → cross-encoder rerank, keep top-N
9. Build context          → assemble system prompt + history + chunks + token budget check
10. Generate              → LLM call, streamed
11. Validate citations    → verify all [N] references map to provided chunks
12. Faithfulness check    → optional second LLM call if FAITHFULNESS_CHECK=true
13. Store in cache        → with source chunk IDs and content hashes
14. Append to session     → update session history
15. Log to audit          → full event with scores, latency, sources
16. Return response       → answer + citations + metadata
```

**Cache grounding check (step 5, cache hit path):**
```typescript
async function validateCacheGrounding(
  hit: CachedResponse,
  vectorAdapter: VectorAdapter
): Promise<boolean> {
  for (const source of hit.sourceChunks) {
    const current = await vectorAdapter.getById(source.chunkId)
    if (!current) return false                            // chunk deleted
    if (current.contentHash !== source.contentHash) return false  // chunk changed
  }
  return true
}
```

**System prompt construction:**
The system prompt must be assembled server-side and must never be user-modifiable. It consists of:
1. Bot persona (`BOT_PERSONA` env var)
2. Hard rules (never use outside knowledge, always cite, say "I don't know" when unsure)
3. Retrieved context chunks, numbered `[1]`, `[2]`, etc. with source metadata
4. Conversation history (bounded by `SESSION_MAX_TURNS`)

The rules section must always appear between the persona and the context — never omit it, never let it be overridden by user input.

**Token budget enforcement:**
Before sending to the LLM, count tokens in the assembled prompt. If over the budget:
1. First: summarise oldest conversation turns (keep recent turns verbatim)
2. Second: reduce chunk count (drop lowest-rerank-score chunks first)
3. Never: silently truncate mid-chunk

**Fallback response:**
When `MIN_RETRIEVAL_CONFIDENCE` is not met, return:
```typescript
{
  answer: "I don't have reliable information about that in my knowledge base.",
  sources: [],
  confidence: bestScore,
  escalate: true,   // flag for human handoff integrations
  fromCache: false,
}
```
Do not call the LLM when retrieval confidence is too low — it will hallucinate.

**Session store:**
Two implementations behind a common interface:
- `InMemorySessionStore` — development, no persistence
- `RedisSessionStore` — production, uses `ioredis`, supports Upstash and ElastiCache GovCloud

### Phase 8 — packages/ui-components

Shared React components used by both the web app and the widget.

**Components to build:**

```
ChatContainer       # Root component, manages message list + input
MessageList         # role="log" aria-live="polite" — announces new messages
Message             # Individual message bubble (user / assistant / system)
SourceCitations     # Renders [1], [2] as expandable citation cards
TypingIndicator     # role="status" aria-live="polite"
ChatInput           # Textarea + send button, keyboard accessible
FeedbackButtons     # Thumbs up/down — fires feedback event
StreamingText       # Handles token-by-token rendering + screen reader buffering
```

**Accessibility requirements (non-negotiable for every component):**
- Full keyboard navigation — no mouse-only interactions
- Visible focus rings — never `outline: none` without a replacement
- `role` and `aria-*` attributes on all interactive and live elements
- `StreamingText` must buffer announcements to the `aria-live` region — not announce every token. Buffer by sentence boundary or `STREAM_BUFFER_MS` milliseconds, whichever comes first
- Colour contrast minimum 4.5:1 for all text
- Never use colour alone to convey state — always pair with icon or text label

**All components accept a `theme` prop** for brand customisation. Default to CSS custom properties so agencies can override with their design system.

### Phase 9 — apps/web

Next.js 14 App Router chat UI.

**Routes:**
```
/                   # Chat interface
/api/chat           # POST — streaming chat endpoint
/api/ingest         # POST — document ingestion (admin-gated)
/api/health         # GET — liveness + readiness check
/api/feedback       # POST — thumbs up/down event
```

**`/api/chat` requirements:**
- Auth middleware runs first (when `AUTH_ENABLED=true`)
- Rate limiting runs second
- Sanitise and validate request body
- Instantiate RAG pipeline from env config (singleton per process, not per request)
- Stream response using Vercel AI SDK `StreamingTextResponse` or native `ReadableStream`
- Every request logged to audit logger

**`/api/health`:**
```typescript
// Returns 200 when all dependencies are reachable
{
  status: "ok" | "degraded" | "down",
  llm: "ok" | "error",
  vectorStore: "ok" | "error",
  cache: "ok" | "error",
  version: string,
  uptime: number
}
```

**Environment validation:**
On startup, validate that all required env vars for the configured providers are present. Fail fast with a clear error message — do not start with a broken config. Use `zod` for env schema validation.

### Phase 10 — apps/bot

Slack and Teams adapters.

**Slack:**
- Bolt.js with Socket Mode (`SLACK_APP_TOKEN`)
- Respond to `app_mention` events in channels
- Respond to `message` events in DMs
- Per-thread session window — `session_id = thread_ts || channel`
- Format responses with Block Kit: answer text + source citation blocks
- Typing indicator: call `chat.typing` before the pipeline runs

**Teams:**
- Azure Bot Framework SDK
- Activity handler for `message` activity type
- Per-conversation session window
- Adaptive Cards for source citations
- Middleware validates Bot Framework auth token on every request

Both bots share the same `rag-core` pipeline — the adapter layer only handles message format translation and auth.

### Phase 11 — apps/widget

Self-contained embeddable chat widget.

**Build output:** A single `widget.js` file that injects a chat UI into any host page via a `<script>` tag.

```html
<script
  src="https://your-api.com/widget.js"
  data-bot-id="your-bot-id"
  data-primary-color="#0066FF"
  data-position="bottom-right"
  data-mode="bubble"
></script>
```

**Requirements:**
- Iframe-sandboxed — the widget's DOM must not pollute the host page
- Configurable via `data-*` attributes: primary colour, bot name, position (bottom-right, bottom-left), mode (bubble, inline)
- Communicates with the API via `postMessage` through the iframe boundary
- CORS enforced server-side via `WIDGET_ALLOWED_ORIGINS` env var — only whitelisted domains can load the widget
- Must pass the same WCAG 2.1 AA checks as the web app
- No cookies — session managed via `sessionStorage` in the iframe

### Phase 12 — federal/ directory

Federal compliance documents and infrastructure templates.

**Compliance documents** (`federal/compliance/`):
These are Markdown templates with pre-populated sections. They are not code — they are documentation that saves agencies weeks of prep work. Write them thoroughly.

- `VPAT.md` — Voluntary Product Accessibility Template covering all WCAG 2.0 Level AA success criteria, with conformance levels (Supports / Partially Supports / Does Not Support / Not Applicable) pre-filled for the components built in Phase 8
- `SSP-template.md` — System Security Plan outline with sections for system description, boundary definition, data flows, and NIST 800-53 Rev 5 control responses pre-populated for this architecture
- `controls-matrix.md` — Table mapping every NIST 800-53 Rev 5 control to: Inherited (cloud provider), Hybrid, or Agency-owned — with notes on what evidence each agency-owned control requires
- `IR-runbook.md` — Incident response procedures for: data breach, prompt injection attack, unauthorised access, knowledge base poisoning, service outage

**Infrastructure templates** (`federal/infra/`):
- `terraform-govcloud/` — Terraform modules for: ECS Fargate (API), Aurora PostgreSQL with pgvector (vector store), ElastiCache Redis (session), ALB, VPC, IAM roles. All resources tagged with `deployment_mode = federal`.
- `azure-gov/` — ARM templates for the equivalent Azure Government stack

**`federal/FEDERAL.md`:**
A standalone guide covering: FedRAMP impact level selection, GovCloud access setup for Bedrock and Azure Government, SAML configuration, ATO process overview, and the controls inheritance model. This is the document a GovTech contractor hands to an agency ISSO.

### Phase 13 — scripts/

Four CLI scripts. All use `ts-node` and accept flags via `yargs` or `commander`.

**`scripts/ingest.ts`**
```
Flags:
  --source <path|url>     Source file, directory, or URL
  --type <types>          Comma-separated: pdf,md,docx,txt,url,sitemap,notion,confluence
  --namespace <ns>        Vector store namespace (required)
  --chunk-size <n>        Token chunk size (default: from env)
  --chunk-overlap <n>     Token overlap (default: from env)
  --dry-run               Parse and chunk but don't push to vector store

On completion:
  - Logs ingest event to audit logger
  - Calls cache.invalidate(namespace)
  - Prints: N files processed, M chunks created, P tokens, Q errors
```

**`scripts/knowledge-health.ts`**
```
Flags:
  --days <n>              Look back N days in query logs (default: 7)
  --namespace <ns>        Scope to a specific namespace
  --output <path>         Write report to file (default: stdout)
  --threshold <n>         Confidence threshold to flag as a gap (default: from env)

Output:
  Markdown report with:
  - Total queries, cache hit rate, escalation rate
  - Top 20 low-confidence queries (hashed if LOG_QUERY_HASHES=true)
  - Estimated gap topics (clustered by embedding similarity)
  - Recommended actions
```

**`scripts/audit-report.ts`**
```
Flags:
  --from <ISO date>       Start date
  --to <ISO date>         End date (default: now)
  --namespace <ns>        Scope to namespace
  --output <path>         Output path

Output:
  Structured audit report covering: query volume, error rate, cache performance,
  security events, and a NIST 800-53 continuous monitoring evidence summary
```

**`scripts/seed.ts`**
Ingests a small example knowledge base (included in `scripts/seed-data/`) so developers can verify the pipeline works before connecting real documents. Includes: a sample FAQ (Markdown), a sample policy document (PDF), and a sample webpage (URL).

### Phase 14 — docker/ and CI

**`docker/docker-compose.yml`:**
Local dev stack. Services: Chroma (port 8000), Redis (port 6379). Both with named volumes so data persists between restarts. Health checks on both.

**`docker/Dockerfile`:**
Multi-stage build. Builder stage installs all deps and builds. Production stage copies only the compiled output and production deps. Runs as a non-root user. Exposes port 3000.

**`.github/workflows/ci.yml`:**
```yaml
Triggers: push to main, pull_request
Jobs:
  - typecheck: tsc --noEmit across all packages
  - lint: eslint across all packages
  - test: vitest across all packages
  - audit: npm audit --audit-level=high
  - build: turbo build
```

---

## Testing requirements

Use **Vitest** for all tests. Every package must have a `src/__tests__/` directory.

**Minimum coverage per package:**

| Package | What to test |
|---|---|
| `llm-adapters` | Factory function, each adapter with mocked HTTP, error handling |
| `vector-adapters` | Factory function, each adapter with mocked client, namespace scoping |
| `rag-core` | Full pipeline with all dependencies mocked, each guardrail independently, cache hit/miss/grounding-fail paths |
| `ingestion` | Each loader with fixture files, chunker output shape, PII redaction patterns |
| `audit-logger` | Event shape validation, PII exclusion when LOG_QUERY_HASHES=true |
| `ui-components` | Keyboard navigation, ARIA attribute presence, screen reader announcement |
| `apps/web` | API route handlers with mocked pipeline, env validation on startup |

**Fixture files for tests:** Include representative sample documents in `packages/ingestion/src/__tests__/fixtures/` — a small PDF, a Markdown file with headings, a DOCX, and an HTML page.

---

## Code style and comments

**Function comments:** Every exported function needs a JSDoc comment explaining purpose, parameters, return value, and any non-obvious behaviour.

```typescript
/**
 * Validates that a cache hit's source chunks still exist in the vector store
 * and that their content hasn't changed since the response was cached.
 *
 * This prevents serving stale answers after a knowledge base update — the
 * ingest pipeline re-ingests documents but the cache may still hold responses
 * built from the old chunk content.
 *
 * @param hit - The cached response to validate
 * @param vectorAdapter - The vector store adapter to check against
 * @returns true if all source chunks exist and match their stored content hash
 */
export async function validateCacheGrounding(
  hit: CachedResponse,
  vectorAdapter: VectorAdapter
): Promise<boolean>
```

**Inline comments:** Any non-trivial logic — especially in the pipeline, the token budget enforcement, and the auth middleware — should have inline comments explaining the reasoning, not just the mechanics.

**Error messages:** All thrown errors must include enough context to debug without a stack trace. Include the env var name, the expected value format, and a pointer to `CONFIG.md` for configuration errors.

```typescript
throw new Error(
  `LLM_PROVIDER "bedrock-gov" requires AWS_REGION to be a GovCloud region ` +
  `(us-gov-west-1 or us-gov-east-1). Got: "${env.AWS_REGION}". ` +
  `See CONFIG.md#federal-deployment for setup instructions.`
)
```

---

## Environment validation

On startup, validate the env using `zod`. Fail fast — do not attempt to start with a broken config. The schema must:

- Mark fields required or optional based on the active `LLM_PROVIDER`, `VECTOR_STORE`, `AUTH_PROVIDER`, and `DEPLOYMENT_MODE`
- Validate that `AWS_REGION` is a GovCloud region when `LLM_PROVIDER=bedrock-gov`
- Validate that `PGVECTOR_SSL=require` when `DEPLOYMENT_MODE=federal`
- Validate that `AUTH_ENABLED=true` when `DEPLOYMENT_MODE=federal`
- Reject `DEPLOYMENT_MODE=federal` if `VECTOR_STORE=pinecone` (Pinecone has no FedRAMP auth)

Export the validated env as a typed object. Never read `process.env` directly outside this validation module.

---

## What this repo is — remind yourself while building

This is not a product. It is an honest, production-quality starting point that agencies and businesses take and make their own. The code you write will be read by:

- A developer at a GovTech contractor trying to understand how to wire RAG into a federal environment
- An agency IT team lead deciding whether to trust this system with real policy documents
- A developer learning how production RAG actually works

Every file should be something you'd be comfortable handing to any of those people. Clear structure, real comments, no shortcuts that would bite someone six months after launch.

The README says: "This is a head start, not a finished product." The code should say the same thing — clearly structured, obviously extensible, with every hook and adapter labelled so the next person knows exactly where to add their thing.
