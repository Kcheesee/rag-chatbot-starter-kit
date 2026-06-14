/**
 * Shared implementation for OpenAI-compatible chat providers.
 *
 * OpenAI direct, Azure OpenAI, Azure Government, and the internal 1P endpoint all
 * speak the `/v1/chat/completions` shape — they differ only in how the client is
 * constructed (key vs Managed Identity vs mTLS) and which `model`/deployment name
 * is targeted. That construction is the one abstract method subclasses provide.
 */

import type OpenAI from "openai";

import type { ChatMessage, ChatOptions, ChatResponse, LLMAdapter } from "../types";
import { mapOpenAIFinishReason, splitConversation } from "./messages";

export abstract class OpenAICompatibleAdapter implements LLMAdapter {
  abstract readonly provider: string;
  private client?: OpenAI;

  constructor(
    readonly model: string,
    private readonly maxTokens: number,
    private readonly temperature: number | undefined,
  ) {}

  /** Construct the provider-specific OpenAI client (key / identity / mTLS). */
  protected abstract createClient(): Promise<OpenAI>;

  private async getClient(): Promise<OpenAI> {
    if (!this.client) this.client = await this.createClient();
    return this.client;
  }

  private buildMessages(
    messages: ChatMessage[],
    optionSystem: string | undefined,
  ): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
    const { system, turns } = splitConversation(messages, optionSystem);
    const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
    if (system) out.push({ role: "system", content: system });
    for (const turn of turns) out.push({ role: turn.role, content: turn.content });
    return out;
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const client = await this.getClient();
    const temperature = options?.temperature ?? this.temperature;

    const res = await client.chat.completions.create(
      {
        model: this.model,
        messages: this.buildMessages(messages, options?.system),
        max_tokens: options?.maxTokens ?? this.maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(options?.stop ? { stop: options.stop } : {}),
      },
      { signal: options?.signal },
    );

    const choice = res.choices[0];
    return {
      content: choice?.message?.content ?? "",
      model: res.model,
      usage: res.usage
        ? { inputTokens: res.usage.prompt_tokens, outputTokens: res.usage.completion_tokens }
        : undefined,
      finishReason: mapOpenAIFinishReason(choice?.finish_reason),
    };
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    const client = await this.getClient();
    const temperature = options?.temperature ?? this.temperature;

    const stream = await client.chat.completions.create(
      {
        model: this.model,
        messages: this.buildMessages(messages, options?.system),
        max_tokens: options?.maxTokens ?? this.maxTokens,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(options?.stop ? { stop: options.stop } : {}),
        stream: true,
      },
      { signal: options?.signal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
