/**
 * Cohere embeddings (HTTP). Used directly via the v2 embed endpoint rather than the
 * SDK to keep this package's dependency surface small.
 */

import type { EmbeddingAdapter } from "../types";
import { requireConfig, type EmbeddingConfig } from "../config";
import { dimensionsFor } from "./dimensions";

const COHERE_EMBED_URL = "https://api.cohere.com/v2/embed";

export class CohereEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = "cohere";
  readonly model: string;
  readonly dimensions: number;
  private readonly apiKey: string;

  constructor(cfg: EmbeddingConfig) {
    this.model = cfg.EMBEDDING_MODEL;
    this.dimensions = dimensionsFor(this.model, 1024);
    this.apiKey = requireConfig(cfg.COHERE_API_KEY, "COHERE_API_KEY", "Get a key from dashboard.cohere.com.");
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await fetch(COHERE_EMBED_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      // `search_document` is the correct input_type for content being indexed.
      body: JSON.stringify({
        model: this.model,
        texts,
        input_type: "search_document",
        embedding_types: ["float"],
      }),
    });

    if (!res.ok) {
      throw new Error(`Cohere embed failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const json = (await res.json()) as { embeddings?: { float?: number[][] } };
    return json.embeddings?.float ?? [];
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector ?? [];
  }
}
