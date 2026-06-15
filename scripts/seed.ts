/**
 * Seed CLI — ingest the bundled demo knowledge bases so a developer can try the
 * pipeline before connecting real documents.
 *
 *   npm run seed                 # seed every demo corpus
 *   npm run seed -- --only bread # seed just one (default | bread | meds | pubsec)
 *
 * Each corpus is ingested into its OWN namespace, which doubles as a live demo of the
 * kit's multi-tenant namespace isolation: the same pipeline answers from "bread",
 * "meds", or "pubsec" depending on the namespace the request asks for. The web app's
 * namespace picker (and the API's `namespace` field) switch between them.
 *
 * Requires a reachable vector store (docker compose up) and an embeddings key.
 */

import { fileURLToPath } from "node:url";

import { initAuditLogger } from "@rag-chat-agent/audit-logger";
import { createEmbeddingAdapter } from "@rag-chat-agent/llm-adapters";
import { createVectorAdapter } from "@rag-chat-agent/vector-adapters";
import { loadEnv, toAuditLoggerConfig } from "@rag-chat-agent/rag-core";
import { createLoaders, ingest } from "@rag-chat-agent/ingestion";

/** The demo corpora: a seed-data subfolder, the namespace it lands in, and a sample ask. */
const DATASETS = [
  { dir: "support", namespace: "default", ask: "What is the refund window?" },
  { dir: "bread", namespace: "bread", ask: "Why is my crumb dense?" },
  { dir: "meds", namespace: "meds", ask: "What is the generic name of Tylenol?" },
  { dir: "pubsec", namespace: "pubsec", ask: "How do I renew my passport?" },
] as const;

// Optional `--only <name>` filter so you can re-seed a single corpus.
const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx !== -1 ? process.argv[onlyIdx + 1] : undefined;
const datasets = only ? DATASETS.filter((d) => d.namespace === only || d.dir === only) : DATASETS;

if (datasets.length === 0) {
  process.stderr.write(
    `No demo corpus matches "--only ${only}". ` +
      `Choose one of: ${DATASETS.map((d) => d.namespace).join(", ")}.\n`,
  );
  process.exit(1);
}

const env = loadEnv();
const audit = initAuditLogger(toAuditLoggerConfig(env));
const embedder = createEmbeddingAdapter(env);
const vectorStore = createVectorAdapter(env);

const lines: string[] = [];
for (const dataset of datasets) {
  const dir = fileURLToPath(new URL(`./seed-data/${dataset.dir}`, import.meta.url));
  const loaders = await createLoaders(dir, ["md", "txt"], {});
  const result = await ingest(
    loaders,
    { namespace: dataset.namespace, chunkSize: env.CHUNK_SIZE, chunkOverlap: env.CHUNK_OVERLAP },
    { embedder, vectorStore, audit, environment: env.NODE_ENV, deploymentMode: env.DEPLOYMENT_MODE },
  );
  lines.push(
    `  • ${dataset.namespace.padEnd(8)} ${result.filesProcessed} files, ${result.chunksCreated} chunks, ` +
      `≈${result.tokensProcessed} tokens  →  try: "${dataset.ask}"`,
  );
}

await audit.flush();

process.stdout.write(
  `\nSeeded ${datasets.length} demo corpus${datasets.length === 1 ? "" : "es"}:\n` +
    `${lines.join("\n")}\n\n` +
    `Run the web app (npm run dev --workspace=apps/web), pick a knowledge base from the\n` +
    `dropdown, and ask one of the questions above. Ask something off-topic to watch the\n` +
    `low-confidence fallback decline instead of hallucinate.\n`,
);
