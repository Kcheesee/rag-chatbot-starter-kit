/**
 * The primary consumer API: pick a vector store adapter from config.
 *
 * This switch is the only place a store is selected. Each adapter validates its own
 * required settings in its constructor, so a misconfigured store fails fast here
 * rather than on the first query.
 */

import type { VectorAdapter } from "./types";
import type { VectorStoreConfig } from "./config";
import { ChromaAdapter } from "./chroma";
import { PineconeAdapter } from "./pinecone";
import { PgVectorAdapter } from "./pgvector";
import { WeaviateAdapter } from "./weaviate";

/** Construct the configured vector store adapter (scoped to the default namespace). */
export function createVectorAdapter(config: VectorStoreConfig): VectorAdapter {
  switch (config.VECTOR_STORE) {
    case "chroma":
      return new ChromaAdapter(config);
    case "pinecone":
      return new PineconeAdapter(config);
    case "pgvector":
      return new PgVectorAdapter(config);
    case "weaviate":
      return new WeaviateAdapter(config);
    default: {
      const exhaustive: never = config.VECTOR_STORE;
      throw new Error(
        `Unknown VECTOR_STORE: "${String(exhaustive)}". ` +
          `Valid values: chroma | pinecone | pgvector | weaviate. See CONFIG.md#vector-store.`,
      );
    }
  }
}
