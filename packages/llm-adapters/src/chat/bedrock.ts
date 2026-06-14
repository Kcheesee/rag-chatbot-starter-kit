/**
 * AWS Bedrock adapters — commercial (Tier 2) and GovCloud (Tier 3).
 *
 * Claude on Bedrock speaks the Anthropic Messages format wrapped in Bedrock's
 * Invoke API. Credentials come from the default AWS provider chain — an IAM task
 * role in production, `aws sso login` locally — never a static key. The GovCloud
 * variant additionally asserts the region is a `us-gov-*` region.
 */

import type {
  BedrockRuntimeClient,
  InvokeModelCommandOutput,
  ResponseStream,
} from "@aws-sdk/client-bedrock-runtime";

import type { ChatMessage, ChatOptions, ChatResponse, LLMAdapter } from "../types";
import { isGovCloudRegion, requireConfig, samplingParams, type LLMConfig } from "../config";
import { mapAnthropicStopReason, splitConversation } from "./messages";

const BEDROCK_ANTHROPIC_VERSION = "bedrock-2023-05-31";

abstract class AbstractBedrockAdapter implements LLMAdapter {
  abstract readonly provider: string;
  readonly model: string;
  protected readonly region: string;
  private readonly maxTokens: number;
  private client?: BedrockRuntimeClient;

  constructor(protected readonly cfg: LLMConfig) {
    this.model = requireConfig(
      cfg.AWS_BEDROCK_MODEL,
      "AWS_BEDROCK_MODEL",
      'Set it to a Bedrock model id, e.g. "anthropic.claude-sonnet-4-6".',
    );
    this.region = requireConfig(cfg.AWS_REGION, "AWS_REGION", "Set your AWS region.");
    this.maxTokens = cfg.MAX_TOKENS ?? 1024;
  }

  private async getClient(): Promise<BedrockRuntimeClient> {
    if (!this.client) {
      const { BedrockRuntimeClient: Client } = await import("@aws-sdk/client-bedrock-runtime");
      // No credentials passed → default provider chain (IAM role / SSO).
      this.client = new Client({ region: this.region });
    }
    return this.client;
  }

  /** Assemble the Bedrock-wrapped Anthropic request body. */
  private body(messages: ChatMessage[], options: ChatOptions | undefined): string {
    const { system, turns } = splitConversation(messages, options?.system);
    return JSON.stringify({
      anthropic_version: BEDROCK_ANTHROPIC_VERSION,
      max_tokens: options?.maxTokens ?? this.maxTokens,
      ...(system ? { system } : {}),
      ...samplingParams(this.model, options?.temperature ?? this.cfg.TEMPERATURE),
      ...(options?.stop ? { stop_sequences: options.stop } : {}),
      messages: turns,
    });
  }

  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResponse> {
    const client = await this.getClient();
    const { InvokeModelCommand } = await import("@aws-sdk/client-bedrock-runtime");

    const res: InvokeModelCommandOutput = await client.send(
      new InvokeModelCommand({
        modelId: this.model,
        contentType: "application/json",
        accept: "application/json",
        body: this.body(messages, options),
      }),
      { abortSignal: options?.signal },
    );

    const payload = JSON.parse(new TextDecoder().decode(res.body)) as {
      content?: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage?: { input_tokens: number; output_tokens: number };
    };
    const text = (payload.content ?? [])
      .map((block) => (block.type === "text" ? (block.text ?? "") : ""))
      .join("");

    return {
      content: text,
      model: this.model,
      usage: payload.usage
        ? { inputTokens: payload.usage.input_tokens, outputTokens: payload.usage.output_tokens }
        : undefined,
      finishReason: mapAnthropicStopReason(payload.stop_reason),
    };
  }

  async *stream(messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<string, void, unknown> {
    const client = await this.getClient();
    const { InvokeModelWithResponseStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");

    const res = await client.send(
      new InvokeModelWithResponseStreamCommand({
        modelId: this.model,
        contentType: "application/json",
        accept: "application/json",
        body: this.body(messages, options),
      }),
      { abortSignal: options?.signal },
    );

    if (!res.body) return;
    const decoder = new TextDecoder();
    for await (const event of res.body as AsyncIterable<ResponseStream>) {
      const bytes = event.chunk?.bytes;
      if (!bytes) continue;
      const parsed = JSON.parse(decoder.decode(bytes)) as {
        type?: string;
        delta?: { type?: string; text?: string };
      };
      if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
        yield parsed.delta.text ?? "";
      }
    }
  }
}

/** AWS Bedrock (commercial). */
export class BedrockAdapter extends AbstractBedrockAdapter {
  readonly provider = "bedrock";
}

/** AWS Bedrock GovCloud — region must be us-gov-*. */
export class BedrockGovAdapter extends AbstractBedrockAdapter {
  readonly provider = "bedrock-gov";

  constructor(cfg: LLMConfig) {
    super(cfg);
    if (!isGovCloudRegion(this.region)) {
      throw new Error(
        `LLM_PROVIDER="bedrock-gov" requires AWS_REGION to be a GovCloud region ` +
          `(us-gov-west-1 or us-gov-east-1). Got: "${this.region}". ` +
          `See CONFIG.md#federal-deployment.`,
      );
    }
  }
}
