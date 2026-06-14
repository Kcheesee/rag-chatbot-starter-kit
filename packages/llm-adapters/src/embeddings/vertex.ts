/**
 * Google Vertex AI embeddings (Tier 2). Calls the `:predict` REST endpoint with an
 * ADC-derived bearer token (no static key), keeping the dependency surface to just
 * `google-auth-library`.
 */

import type { GoogleAuth } from "google-auth-library";

import type { EmbeddingAdapter } from "../types";
import { requireConfig, type EmbeddingConfig } from "../config";
import { dimensionsFor } from "./dimensions";

export class VertexEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = "vertex";
  readonly model: string;
  readonly dimensions: number;
  private readonly project: string;
  private readonly location: string;
  private auth?: GoogleAuth;

  constructor(cfg: EmbeddingConfig) {
    this.model = cfg.EMBEDDING_MODEL;
    this.dimensions = dimensionsFor(this.model, 768);
    this.project = requireConfig(cfg.VERTEX_PROJECT, "VERTEX_PROJECT", "Your GCP project id.");
    this.location = requireConfig(cfg.VERTEX_LOCATION, "VERTEX_LOCATION", "Your Vertex region.");
  }

  private async getAuth(): Promise<GoogleAuth> {
    if (!this.auth) {
      const { GoogleAuth: Auth } = await import("google-auth-library");
      this.auth = new Auth({ scopes: "https://www.googleapis.com/auth/cloud-platform" });
    }
    return this.auth;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const auth = await this.getAuth();
    const token = await (await auth.getClient()).getAccessToken();
    if (!token.token) throw new Error("Failed to acquire a Google access token (check ADC).");

    const url =
      `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}` +
      `/locations/${this.location}/publishers/google/models/${this.model}:predict`;

    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ instances: texts.map((content) => ({ content })) }),
    });
    if (!res.ok) {
      throw new Error(`Vertex embed failed: ${res.status} ${res.statusText} — ${await res.text()}`);
    }
    const json = (await res.json()) as {
      predictions?: Array<{ embeddings?: { values?: number[] } }>;
    };
    return (json.predictions ?? []).map((p) => p.embeddings?.values ?? []);
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector ?? [];
  }
}
