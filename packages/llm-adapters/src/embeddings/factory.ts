/** The primary consumer API for embeddings: pick an adapter from config. */

import type { EmbeddingAdapter } from "../types";
import type { EmbeddingConfig } from "../config";
import { OpenAIEmbeddingAdapter } from "./openai";
import { CohereEmbeddingAdapter } from "./cohere";
import { VoyageEmbeddingAdapter } from "./voyage";
import { BedrockEmbeddingAdapter } from "./bedrock";
import { VertexEmbeddingAdapter } from "./vertex";

/** Construct the configured embedding adapter. */
export function createEmbeddingAdapter(config: EmbeddingConfig): EmbeddingAdapter {
  switch (config.EMBEDDING_PROVIDER) {
    case "openai":
      return new OpenAIEmbeddingAdapter(config);
    case "cohere":
      return new CohereEmbeddingAdapter(config);
    case "voyage":
      return new VoyageEmbeddingAdapter(config);
    case "bedrock":
      return new BedrockEmbeddingAdapter(config);
    case "vertex":
      return new VertexEmbeddingAdapter(config);
    default: {
      const exhaustive: never = config.EMBEDDING_PROVIDER;
      throw new Error(
        `Unknown EMBEDDING_PROVIDER: "${String(exhaustive)}". ` +
          `Valid values: openai | cohere | voyage | bedrock | vertex. See CONFIG.md#embeddings.`,
      );
    }
  }
}
