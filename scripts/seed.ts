/**
 * Seed CLI — ingest the bundled example knowledge base so a developer can verify
 * the pipeline before connecting real documents.
 *
 *   npm run seed
 *
 * Ingests scripts/seed-data/* into the "default" namespace (the namespace the web
 * app queries), then prints a summary. Requires a vector store reachable (docker
 * compose up) and an embeddings key (EMBEDDING_PROVIDER's key).
 */

import { fileURLToPath } from "node:url";

import { initAuditLogger } from "@rag-chat-agent/audit-logger";
import { createEmbeddingAdapter } from "@rag-chat-agent/llm-adapters";
import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";
import { loadEnv, toAuditLoggerConfig } from "@rag-chat-agent/rag-core";
import { createLoaders, ingest } from "@rag-chat-agent/ingestion";

const SEED_NAMESPACE = "default";
const seedDir = fileURLToPath(new URL("./seed-data", import.meta.url));

const env = loadEnv();
const audit = initAuditLogger(toAuditLoggerConfig(env));
const embedder = createEmbeddingAdapter(env);
const vectorStore = createVectorAdapter(env);

const loaders = await createLoaders(seedDir, ["md", "txt"], {});
const result = await ingest(
  loaders,
  { namespace: SEED_NAMESPACE, chunkSize: env.CHUNK_SIZE, chunkOverlap: env.CHUNK_OVERLAP },
  { embedder, vectorStore, audit, environment: env.NODE_ENV, deploymentMode: env.DEPLOYMENT_MODE },
);

await audit.flush();

process.stdout.write(
  `\nSeeded namespace "${SEED_NAMESPACE}": ${result.filesProcessed} files, ` +
    `${result.chunksCreated} chunks, ≈${result.tokensProcessed} tokens, ${result.errors} errors.\n` +
    `Now run the web app and ask: "What is the refund window?"\n`,
);
