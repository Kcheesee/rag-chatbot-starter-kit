/**
 * Voyage AI embeddings (HTTP). Anthropic's recommended embeddings partner, so this
 * is the natural OpenAI-free default for an all-Anthropic dev stack.
 */

import type { EmbeddingAdapter, EmbeddingMode } from "../types";
import { requireConfig, type EmbeddingConfig } from "../config";
import { dimensionsFor } from "./dimensions";

const VOYAGE_EMBED_URL = "https://api.voyageai.com/v1/embeddings";

export class VoyageEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = "voyage";
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;

  constructor(cfg: EmbeddingConfig) {
    this.model = cfg.EMBEDDING_MODEL;
    this.dimensions = dimensionsFor(this.model, 1024);
    this.apiKey = requireConfig(cfg.VOYAGE_API_KEY, "VOYAGE_API_KEY", "Get a key from voyageai.com.");
  }

  async embed(texts: string[], mode: EmbeddingMode = "document"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(VOYAGE_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      // Voyage's input_type values are literally "document" / "query".
      body: JSON.stringify({ input: texts, model: this.model, input_type: mode }),
    });

    if (!res.ok) {
      throw new Error(`Voyage embed failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: Array<{ embedding: number[]; index: number }> };
    return (json.data ?? []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }

  async embedOne(text: string, mode: EmbeddingMode = "document"): Promise<number[]> {
    const [vector] = await this.embed([text], mode);
    return vector ?? [];
  }
}
