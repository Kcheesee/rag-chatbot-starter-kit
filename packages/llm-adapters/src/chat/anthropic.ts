/**
 * Direct Anthropic API adapter (Tier 1 dev).
 *
 * The SDK is imported lazily so a deployment that uses a different provider never
 * loads it. `temperature` is attached only when the configured model accepts it
 * (see `samplingParams`) — Opus 4.7+/4.8 and Fable 5 reject it.
 */

import type AnthropicSDK from "@anthropic-ai/sdk";

import type { ChatMessage, ChatOptions, ChatResponse, LLMAdapter } from "../types";
import { requireConfig, samplingParams, type LLMConfig } from "../config";
import { mapAnthropicStopReason, splitConversation } from "./messages";

export class AnthropicAdapter implements LLMAdapter {
  readonly provider = "anthropic";
  readonly model: string;
  private client?: AnthropicSDK;
  private readonly apiKey: string;
  private readonly maxTokens: number;

  constructor(private readonly cfg: LLMConfig) {
    this.model = cfg.LLM_MODEL;
    this.maxTokens = cfg.MAX_TOKENS ?? 1024;
    this.apiKey = requireConfig(
      cfg.ANTHROPIC_API_KEY,
      "ANTHROPIC_API_KEY",
      "Grab a key from console.anthropic.com for local dev.",
    );
  }

  /** Lazily construct and memoise the SDK client. */
  private async getClient(): Promise<AnthropicSDK> {
    if (!this.client) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      this.client = new Anthropic({ apiKey: this.apiKey });
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
