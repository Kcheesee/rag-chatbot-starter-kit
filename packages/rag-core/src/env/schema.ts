/**
 * The validated environment schema — the single source of truth for configuration.
 *
 * Every other module consumes the typed `Env` this produces; none reads process.env
 * directly. Field keys match the env-variable names so `Env` is structurally
 * assignable to the adapter configs (`createLLMAdapter(env)` etc. "just work").
 *
 * The `superRefine` block encodes the federal invariants the spec mandates — these
 * fail validation at startup rather than surfacing as a runtime surprise.
 */

import { z } from "zod";

const GOVCLOUD_REGIONS = ["us-gov-west-1", "us-gov-east-1"];

/** Parse a truthy/falsy env string into a boolean, with a default. */
const zBool = (def: boolean): z.ZodType<boolean> =>
  z.preprocess(
    (v) => (v === undefined ? def : String(v).toLowerCase() === "true"),
    z.boolean(),
  ) as z.ZodType<boolean>;

export const EnvSchema = z
  .object({
    // ── Runtime ──
    NODE_ENV: z.string().default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    APP_VERSION: z.string().default("0.1.0"),

    // ── LLM ──
    LLM_PROVIDER: z
      .enum([
        "anthropic",
        "openai",
        "bedrock",
        "vertex",
        "azure-openai",
        "bedrock-gov",
        "azure-gov",
        "internal",
      ])
      .default("anthropic"),
    LLM_MODEL: z.string().default("claude-sonnet-4-6"),
    MAX_TOKENS: z.coerce.number().int().positive().default(1024),
    TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
    ANTHROPIC_API_KEY: z.string().optional(),
    OPENAI_API_KEY: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_BEDROCK_MODEL: z.string().optional(),
    VERTEX_PROJECT: z.string().optional(),
    VERTEX_LOCATION: z.string().optional(),
    VERTEX_MODEL: z.string().optional(),
    AZURE_OPENAI_ENDPOINT: z.string().optional(),
    AZURE_OPENAI_DEPLOYMENT: z.string().optional(),
    AZURE_OPENAI_API_VERSION: z.string().optional(),
    AZURE_OPENAI_API_KEY: z.string().optional(),
    INTERNAL_LLM_ENDPOINT: z.string().optional(),
    INTERNAL_LLM_MODEL: z.string().optional(),
    INTERNAL_LLM_CERT_PATH: z.string().optional(),
    INTERNAL_LLM_KEY_PATH: z.string().optional(),
    INTERNAL_LLM_CA_PATH: z.string().optional(),

    // ── Embeddings ──
    EMBEDDING_PROVIDER: z.enum(["openai", "cohere", "voyage", "bedrock", "vertex"]).default("openai"),
    EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),
    COHERE_API_KEY: z.string().optional(),
    VOYAGE_API_KEY: z.string().optional(),

    // ── Vector store ──
    VECTOR_STORE: z.enum(["chroma", "pinecone", "pgvector", "weaviate"]).default("chroma"),
    VECTOR_NAMESPACE_PREFIX: z.string().default("rag_chunks"),
    CHROMA_URL: z.string().optional(),
    PINECONE_API_KEY: z.string().optional(),
    PINECONE_INDEX: z.string().optional(),
    WEAVIATE_URL: z.string().optional(),
    WEAVIATE_API_KEY: z.string().optional(),
    PGVECTOR_HOST: z.string().optional(),
    PGVECTOR_PORT: z.coerce.number().int().positive().default(5432),
    PGVECTOR_DATABASE: z.string().default("rag"),
    PGVECTOR_USER: z.string().default("rag"),
    PGVECTOR_PASSWORD: z.string().optional(),
    PGVECTOR_SSL: z.enum(["require", "prefer", "disable"]).default("prefer"),
    PGVECTOR_TABLE: z.string().default("rag_chunks"),

    // ── App / retrieval ──
    BOT_NAME: z.string().default("Aria"),
    BOT_PERSONA: z
      .string()
      .default(
        "You are a warm, caring, and genuinely helpful assistant. Speak in a natural, " +
          "conversational, reassuring tone — like a friendly, knowledgeable person who wants " +
          "to help, not a stiff manual. Explain things clearly and gently, and write in plain, " +
          "flowing sentences. Do not use Markdown formatting such as asterisks, bold, headings, " +
          "or bullet characters; weave any list of items into natural prose. Keep bracketed " +
          "source citations like [1] exactly as they appear.",
      ),
    TOP_K_RESULTS: z.coerce.number().int().positive().default(10),
    TOP_K_AFTER_RERANK: z.coerce.number().int().positive().default(5),
    CHUNK_SIZE: z.coerce.number().int().positive().default(512),
    CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(64),
    HYBRID_SEARCH: zBool(false),
    MAX_CONTEXT_TOKENS: z.coerce.number().int().positive().default(8000),
    QUERY_REWRITE: zBool(false),
    // Reranker that refines top-K retrieval to top-N before generation.
    //   hybrid — dependency-free blend of vector similarity + lexical coverage (default).
    //   cohere — Cohere's cross-encoder rerank API; requires COHERE_API_KEY. RERANK_MODEL
    //            overrides the model id (default rerank-english-v3.0). See CONFIG.md#rerank.
    RERANKER: z.enum(["hybrid", "cohere"]).default("hybrid"),
    RERANK_MODEL: z.string().optional(),

    // ── Response cache ──
    CACHE_ENABLED: zBool(true),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
    CACHE_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.93),
    CACHE_INVALIDATE_ON_MODEL_CHANGE: zBool(true),

    // ── Accuracy guardrails ──
    MIN_RETRIEVAL_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.7),
    // When true, an answer with no valid citation is escalated rather than served
    // as authoritative. Recommended for regulated/high-stakes deployments.
    STRICT_GROUNDING: zBool(false),
    FAITHFULNESS_CHECK: zBool(false),
    FAITHFULNESS_THRESHOLD: z.coerce.number().min(0).max(1).default(0.85),
    // Per-namespace governance overrides as a JSON object, e.g.
    //   {"meds":{"persona":"...","minConfidence":0.8,"strictGrounding":true}}
    // Merged over the bundled demo defaults (bread=open, meds=strict, pubsec=moderate).
    // See CONFIG.md#federal-deployment / the "governance" section in the README.
    NAMESPACE_POLICIES: z.string().optional(),

    // ── Auth (consumed by the web app; here so the schema is the single source) ──
    AUTH_ENABLED: zBool(false),
    AUTH_PROVIDER: z.enum(["clerk", "nextauth", "saml"]).default("clerk"),
    CLERK_SECRET_KEY: z.string().optional(),
    SAML_ENTRY_POINT: z.string().optional(),
    SAML_ISSUER: z.string().default("rag-chat-agent"),
    AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(50),
    // Secure-by-default token verification (see CONFIG.md#auth). With AUTH_ENABLED
    // and NONE of these configured, the API fails CLOSED (rejects every request)
    // rather than trusting an unverified token.
    //   AUTH_STATIC_TOKENS — JSON array of identities for the built-in verifier:
    //     [{ "token": "...", "userId": "...", "admin": true, "namespaces": ["acme"] }]
    //   AUTH_ALLOW_INSECURE_TOKENS — DEV ONLY. Treat any non-empty bearer token as an
    //     opaque user id with no tenant scoping. Never enable in production/federal.
    AUTH_STATIC_TOKENS: z.string().optional(),
    AUTH_ALLOW_INSECURE_TOKENS: zBool(false),
    AUTH_DEFAULT_NAMESPACE: z.string().default("default"),

    // ── Ingestion security (admin ingest API; see CONFIG.md#ingestion) ──
    // INGEST_ROOT — if set, file ingestion is confined to this directory (path
    //   containment + symlink-escape guard). Unset → local paths trusted (CLI use).
    // INGEST_URL_ALLOWLIST — comma-separated host allowlist for url/sitemap loaders
    //   (".example.com" matches subdomains). Unset → any public host permitted.
    INGEST_ROOT: z.string().optional(),
    INGEST_URL_ALLOWLIST: z.string().optional(),
    INGEST_MAX_BYTES: z.coerce.number().int().positive().default(10_000_000),
    INGEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
    INGEST_ALLOW_PRIVATE_NETWORKS: zBool(false),

    // ── Session ──
    SESSION_STORE: z.enum(["memory", "redis"]).default("memory"),
    REDIS_URL: z.string().optional(),
    UPSTASH_REDIS_URL: z.string().optional(),
    UPSTASH_REDIS_TOKEN: z.string().optional(),
    SESSION_MAX_TURNS: z.coerce.number().int().positive().default(20),

    // ── PII redaction ──
    PII_REDACTION_ENABLED: zBool(false),
    PII_REDACTION_PROVIDER: z.enum(["presidio", "aws-comprehend"]).default("presidio"),
    PRESIDIO_URL: z.string().optional(),
    // Minimum Presidio confidence [0,1] for a detection to be redacted. Default 0 keeps the
    // conservative "redact everything Presidio flags" behaviour; raise it (e.g. 0.6–0.8) to
    // trade recall for fewer false-positive redactions corrupting text. See CONFIG.md#pii-redaction.
    PRESIDIO_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0),

    // ── Audit logging ──
    AUDIT_LOG_ENABLED: zBool(false),
    AUDIT_LOG_TARGET: z.enum(["console", "cloudwatch", "s3", "splunk"]).default("console"),
    AUDIT_LOG_RETENTION_DAYS: z.coerce.number().int().positive().default(90),
    LOG_QUERY_HASHES: zBool(false),
    LOG_RESPONSES: zBool(false),
    AUDIT_CLOUDWATCH_LOG_GROUP: z.string().optional(),
    AUDIT_CLOUDWATCH_LOG_STREAM: z.string().optional(),
    AUDIT_S3_BUCKET: z.string().optional(),
    AUDIT_S3_PREFIX: z.string().default("audit"),
    AUDIT_SPLUNK_URL: z.string().optional(),
    AUDIT_SPLUNK_TOKEN: z.string().optional(),

    // ── Federal ──
    DEPLOYMENT_MODE: z.enum(["standard", "federal"]).default("standard"),
    IMPACT_LEVEL: z.enum(["low", "moderate", "high"]).default("low"),
    DATA_CLASSIFICATION: z.enum(["public", "CUI", "sensitive"]).default("public"),
    A11Y_MODE: zBool(false),
    STREAM_BUFFER_MS: z.coerce.number().int().nonnegative().default(500),
    ENFORCE_DATA_RESIDENCY: zBool(false),
    ALLOWED_REGIONS: z.string().default("us-east-1,us-west-2"),

    // ── Widget ──
    WIDGET_ALLOWED_ORIGINS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // GovCloud region required for Bedrock GovCloud.
    if (env.LLM_PROVIDER === "bedrock-gov" && !(env.AWS_REGION && GOVCLOUD_REGIONS.includes(env.AWS_REGION))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AWS_REGION"],
        message: `LLM_PROVIDER=bedrock-gov requires AWS_REGION to be a GovCloud region (${GOVCLOUD_REGIONS.join(" or ")}).`,
      });
    }

    // Data residency: when enforced, every provider region the deployment uses must
    // fall inside ALLOWED_REGIONS. Validated at startup so an out-of-boundary region
    // fails fast rather than silently shipping data across a jurisdiction. Applies in
    // standard mode too (residency isn't federal-only).
    if (env.ENFORCE_DATA_RESIDENCY) {
      const allowed = env.ALLOWED_REGIONS.split(",")
        .map((r) => r.trim())
        .filter(Boolean);
      const checkRegion = (region: string | undefined, key: "AWS_REGION" | "VERTEX_LOCATION"): void => {
        if (region && !allowed.includes(region)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message:
              `${key}="${region}" is outside ALLOWED_REGIONS (${allowed.join(", ")}) but ` +
              "ENFORCE_DATA_RESIDENCY=true. See CONFIG.md#federal-deployment.",
          });
        }
      };
      checkRegion(env.AWS_REGION, "AWS_REGION");
      checkRegion(env.VERTEX_LOCATION, "VERTEX_LOCATION");
    }

    // Federal invariants (the spec's required env validations).
    if (env.DEPLOYMENT_MODE === "federal") {
      if (env.VECTOR_STORE === "pinecone") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["VECTOR_STORE"],
          message: "DEPLOYMENT_MODE=federal cannot use VECTOR_STORE=pinecone (no FedRAMP authorization).",
        });
      }
      if (env.VECTOR_STORE === "pgvector" && env.PGVECTOR_SSL !== "require") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["PGVECTOR_SSL"],
          message: "DEPLOYMENT_MODE=federal requires PGVECTOR_SSL=require.",
        });
      }
      if (!env.AUTH_ENABLED) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_ENABLED"],
          message: "DEPLOYMENT_MODE=federal requires AUTH_ENABLED=true.",
        });
      }
      if (env.AUTH_ALLOW_INSECURE_TOKENS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["AUTH_ALLOW_INSECURE_TOKENS"],
          message:
            "DEPLOYMENT_MODE=federal forbids AUTH_ALLOW_INSECURE_TOKENS=true — wire a real verifier.",
        });
      }
    }
  });

/** The fully-validated, typed environment. */
export type Env = z.infer<typeof EnvSchema>;
