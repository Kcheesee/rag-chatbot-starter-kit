/** OpenAI embeddings (Tier 1 dev default). */

import type OpenAI from "openai";

import type { EmbeddingAdapter, EmbeddingMode } from "../types";
import { requireConfig, type EmbeddingConfig } from "../config";
import { dimensionsFor } from "./dimensions";

export class OpenAIEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = "openai";
  readonly model: string;
  readonly dimensions: number;
  private client?: OpenAI;
  private readonly apiKey: string;

  constructor(cfg: EmbeddingConfig) {
    this.model = cfg.EMBEDDING_MODEL;
    this.dimensions = dimensionsFor(this.model, 1536);
    this.apiKey = requireConfig(
      cfg.OPENAI_API_KEY,
      "OPENAI_API_KEY",
      "OpenAI embeddings need an OpenAI key — even when the LLM provider is Anthropic. " +
        "Set EMBEDDING_PROVIDER=voyage|cohere for an OpenAI-free path.",
    );
  }

  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAIClient } = await import("openai");
      this.client = new OpenAIClient({ apiKey: this.apiKey });
    }
    return this.client;
  }

  // OpenAI embeddings are symmetric: documents and queries use the same model with no
  // input-type distinction, so `mode` is accepted for interface parity but not sent.
  async embed(texts: string[], _mode: EmbeddingMode = "document"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = await this.getClient();
    const res = await client.embeddings.create({ model: this.model, input: texts });
    // The API preserves input order, but sort by index to be defensive.
    return [...res.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async embedOne(text: string, mode: EmbeddingMode = "document"): Promise<number[]> {
    const [vector] = await this.embed([text], mode);
    return vector ?? [];
  }
}
