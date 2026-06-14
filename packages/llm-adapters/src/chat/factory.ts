/**
 * The primary consumer API: pick a chat adapter from config.
 *
 * This switch is the ONLY place a provider is selected. Adding a provider means a
 * new `case` and a new adapter — never a conditional sprinkled through the pipeline.
 */

import type { LLMAdapter } from "../types";
import type { LLMConfig } from "../config";
import { AnthropicAdapter } from "./anthropic";
import { OpenAIAdapter } from "./openai";
import { BedrockAdapter, BedrockGovAdapter } from "./bedrock";
import { AzureOpenAIAdapter, AzureGovAdapter } from "./azure";
import { VertexAdapter } from "./vertex";
import { InternalAdapter } from "./internal";

/** Construct the configured chat adapter. */
export function createLLMAdapter(config: LLMConfig): LLMAdapter {
  switch (config.LLM_PROVIDER) {
    case "anthropic":
      return new AnthropicAdapter(config);
    case "openai":
      return new OpenAIAdapter(config);
    case "bedrock":
      return new BedrockAdapter(config);
    case "vertex":
      return new VertexAdapter(config);
    case "azure-openai":
      return new AzureOpenAIAdapter(config);
    case "bedrock-gov":
      return new BedrockGovAdapter(config);
    case "azure-gov":
      return new AzureGovAdapter(config);
    case "internal":
      return new InternalAdapter(config);
    default: {
      const exhaustive: never = config.LLM_PROVIDER;
      throw new Error(
        `Unknown LLM_PROVIDER: "${String(exhaustive)}". ` +
          `Valid values: anthropic | openai | bedrock | vertex | azure-openai | ` +
          `bedrock-gov | azure-gov | internal. See CONFIG.md#llm-provider.`,
      );
    }
  }
}
