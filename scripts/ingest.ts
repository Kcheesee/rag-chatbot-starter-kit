/**
 * Ingest CLI — push documents into the vector store.
 *
 *   npm run ingest -- --source ./docs --type pdf,md --namespace acme-corp
 *   npm run ingest -- --source https://site.com/sitemap.xml --type sitemap --namespace acme
 *   npm run ingest -- --source ./docs --type md --namespace acme --dry-run
 *
 * On completion it logs an ingest audit event and prints a summary. Notion and
 * Confluence credentials are read from the environment (NOTION_TOKEN, CONFLUENCE_*).
 */

import { Command } from "commander";

import { initAuditLogger } from "@rag-chat-agent/audit-logger";
import { createEmbeddingAdapter } from "@rag-chat-agent/llm-adapters";
import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";
import { loadEnv, toAuditLoggerConfig } from "@rag-chat-agent/rag-core";
import {
  createLoaders,
  createPIIRedactor,
  ingest,
  type LoaderCredentials,
  type LoaderSourceType,
} from "@rag-chat-agent/ingestion";

const program = new Command()
  .requiredOption("--source <path|url>", "Source file, directory, or URL")
  .requiredOption("--type <types>", "Comma-separated: pdf,md,docx,txt,url,sitemap,notion,confluence")
  .requiredOption("--namespace <ns>", "Vector store namespace")
  .option("--chunk-size <n>", "Token chunk size (default: from env)")
  .option("--chunk-overlap <n>", "Token overlap (default: from env)")
  .option("--dry-run", "Parse and chunk but do not embed or write to the store", false)
  .parse(process.argv);

const opts = program.opts<{
  source: string;
  type: string;
  namespace: string;
  chunkSize?: string;
  chunkOverlap?: string;
  dryRun: boolean;
}>();

const env = loadEnv();
const types = opts.type.split(",").map((t) => t.trim()) as LoaderSourceType[];

const creds: LoaderCredentials = {
  ...(process.env.NOTION_TOKEN ? { notionToken: process.env.NOTION_TOKEN } : {}),
  ...(process.env.CONFLUENCE_BASE_URL &&
  process.env.CONFLUENCE_EMAIL &&
  process.env.CONFLUENCE_API_TOKEN
    ? {
        confluence: {
          baseUrl: process.env.CONFLUENCE_BASE_URL,
          email: process.env.CONFLUENCE_EMAIL,
          apiToken: process.env.CONFLUENCE_API_TOKEN,
        },
      }
    : {}),
};

const audit = initAuditLogger(toAuditLoggerConfig(env));
const vectorStore = createVectorAdapter(env);
// Only construct the embedder for a real run — a dry run never embeds, so it works
// without an embeddings key.
const embedder = opts.dryRun ? undefined : createEmbeddingAdapter(env);
const redactor = createPIIRedactor({
  PII_REDACTION_ENABLED: env.PII_REDACTION_ENABLED,
  PII_REDACTION_PROVIDER: env.PII_REDACTION_PROVIDER,
  ...(env.PRESIDIO_URL ? { PRESIDIO_URL: env.PRESIDIO_URL } : {}),
  ...(env.AWS_REGION ? { AWS_REGION: env.AWS_REGION } : {}),
});

const loaders = await createLoaders(opts.source, types, creds);
const result = await ingest(
  loaders,
  {
    namespace: opts.namespace,
    chunkSize: opts.chunkSize ? Number(opts.chunkSize) : env.CHUNK_SIZE,
    chunkOverlap: opts.chunkOverlap ? Number(opts.chunkOverlap) : env.CHUNK_OVERLAP,
    dryRun: opts.dryRun,
  },
  {
    vectorStore,
    audit,
    ...(embedder ? { embedder } : {}),
    ...(redactor ? { redactor } : {}),
    environment: env.NODE_ENV,
    deploymentMode: env.DEPLOYMENT_MODE,
  },
);

await audit.flush();

const redacted = result.redacted.map((r) => `${r.type}:${r.count}`).join(", ") || "none";
process.stdout.write(
  `\n${opts.dryRun ? "[dry run] " : ""}Ingest complete for namespace "${result.namespace}":\n` +
    `  files processed : ${result.filesProcessed}\n` +
    `  chunks created  : ${result.chunksCreated}\n` +
    `  tokens (≈)      : ${result.tokensProcessed}\n` +
    `  errors          : ${result.errors}\n` +
    `  PII redacted    : ${redacted}\n`,
);
