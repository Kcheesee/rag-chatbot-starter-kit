/** Direct OpenAI API adapter (Tier 1 dev). */

import type OpenAI from "openai";

import { requireConfig, type LLMConfig } from "../config";
import { OpenAICompatibleAdapter } from "./openai-base";

export class OpenAIAdapter extends OpenAICompatibleAdapter {
  readonly provider = "openai";
  private readonly apiKey: string;

  constructor(cfg: LLMConfig) {
    super(cfg.LLM_MODEL, cfg.MAX_TOKENS ?? 1024, cfg.TEMPERATURE);
    this.apiKey = requireConfig(
      cfg.OPENAI_API_KEY,
      "OPENAI_API_KEY",
      "Grab a key from platform.openai.com for local dev.",
    );
  }

  protected async createClient(): Promise<OpenAI> {
    const { default: OpenAIClient } = await import("openai");
    return new OpenAIClient({ apiKey: this.apiKey });
  }
}
