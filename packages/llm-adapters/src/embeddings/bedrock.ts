/**
 * AWS Bedrock embeddings (Tier 2/3). Supports Amazon Titan (one text per invoke)
 * and Cohere-on-Bedrock (batched). Credentials come from the default AWS provider
 * chain — the same IAM-role posture as the Bedrock chat adapter.
 */

import type { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";

import type { EmbeddingAdapter } from "../types";
import { requireConfig, type EmbeddingConfig } from "../config";
import { dimensionsFor } from "./dimensions";

export class BedrockEmbeddingAdapter implements EmbeddingAdapter {
  readonly provider = "bedrock";
  readonly model: string;
  readonly dimensions: number;
  private readonly region: string;
  private readonly isCohere: boolean;
  private client?: BedrockRuntimeClient;

  constructor(cfg: EmbeddingConfig) {
    this.model = cfg.EMBEDDING_MODEL;
    this.dimensions = dimensionsFor(this.model, 1024);
    this.region = requireConfig(cfg.AWS_REGION, "AWS_REGION", "Set your AWS (or GovCloud) region.");
    this.isCohere = this.model.includes("cohere");
  }

  private async getClient(): Promise<BedrockRuntimeClient> {
    if (!this.client) {
      const { BedrockRuntimeClient: Client } = await import("@aws-sdk/client-bedrock-runtime");
      this.client = new Client({ region: this.region });
    }
    return this.client;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const client = await this.getClient();
    const { InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");
    const decoder = new TextDecoder();

    const invoke = async (body: unknown): Promise<unknown> => {
      const res = await client.send(
        new InvokeModelCommand({
          modelId: this.model,
          contentType: "application/json",
          accept: "application/json",
          body: JSON.stringify(body),
        }),
      );
      return JSON.parse(decoder.decode(res.body));
    };

    if (this.isCohere) {
      const payload = (await invoke({ texts, input_type: "search_document" })) as {
        embeddings?: number[][];
      };
      return payload.embeddings ?? [];
    }

    // Titan embeds a single text per request — invoke sequentially.
    const out: number[][] = [];
    for (const text of texts) {
      const payload = (await invoke({ inputText: text })) as { embedding?: number[] };
      out.push(payload.embedding ?? []);
    }
    return out;
  }

  async embedOne(text: string): Promise<number[]> {
    const [vector] = await this.embed([text]);
    return vector ?? [];
  }
}
