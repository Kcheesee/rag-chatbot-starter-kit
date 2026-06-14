/**
 * Google Vertex AI adapter for Claude (Tier 2 enterprise).
 *
 * Uses the Anthropic Vertex SDK, which speaks the same Messages API as the direct
 * SDK but authenticates via Google Application Default Credentials (ADC) — no
 * static key. The same model-aware sampling guard applies.
 */

import type { AnthropicVertex } from "@anthropic-ai/vertex-sdk";

import type { ChatMessage, ChatOptions, ChatResponse, LLMAdapter } from "../types";
import { requireConfig, samplingParams, type LLMConfig } from "../config";
import { mapAnthropicStopReason, splitConversation } from "./messages";

export class VertexAdapter implements LLMAdapter {
  readonly provider = "vertex";
  readonly model: string;
  private readonly projectId: string;
  private readonly region: string;
  private readonly maxTokens: number;
  private client?: AnthropicVertex;

  constructor(private readonly cfg: LLMConfig) {
    this.model = requireConfig(
      cfg.VERTEX_MODEL,
      "VERTEX_MODEL",
      'Set it to a Vertex Claude model, e.g. "claude-sonnet-4-6".',
    );
    this.projectId = requireConfig(cfg.VERTEX_PROJECT, "VERTEX_PROJECT", "Your GCP project id.");
    this.region = requireConfig(cfg.VERTEX_LOCATION, "VERTEX_LOCATION", "Your Vertex region.");
    this.maxTokens = cfg.MAX_TOKENS ?? 1024;
  }

  private async getClient(): Promise<AnthropicVertex> {
    if (!this.client) {
      const { AnthropicVertex: Client } = await import("@anthropic-ai/vertex-sdk");
      this.client = new Client({ projectId: this.projectId, region: this.region });
    }
    return this.client;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const client = await this.getClient();
    const { system, turns } = splitConversation(messages, options?.system);

    const res = await client.messages.create(
      {
        model: this.model,
        max_tokens: options?.maxTokens ?? this.maxTokens,
        ...(system ? { system } : {}),
        ...samplingParams(this.model, options?.temperature ?? this.cfg.TEMPERATURE),
        ...(options?.stop ? { stop_sequences: options.stop } : {}),
        messages: turns,
      },
      { signal: options?.signal },
    );

    const text = res.content.map((block) => (block.type === "text" ? block.text : "")).join("");
    return {
      content: text,
      model: res.model,
      usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
      finishReason: mapAnthropicStopReason(res.stop_reason),
    };
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    const client = await this.getClient();
    const { system, turns } = splitConversation(messages, options?.system);

    const stream = client.messages.stream(
      {
        model: this.model,
        max_tokens: options?.maxTokens ?? this.maxTokens,
        ...(system ? { system } : {}),
        ...samplingParams(this.model, options?.temperature ?? this.cfg.TEMPERATURE),
        ...(options?.stop ? { stop_sequences: options.stop } : {}),
        messages: turns,
      },
      { signal: options?.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
