/**
 * Internal / first-party / research-lab adapter (Tier 3 federal).
 *
 * Expects an OpenAI-compatible `/v1/chat/completions` endpoint. Authentication is
 * mutual TLS: the client cert + key are read from paths the infrastructure injects
 * (e.g. mounted secrets). To trust a self-signed agency server cert, point
 * `INTERNAL_LLM_CA_PATH` at the issuing CA bundle — we never disable certificate
 * verification.
 */

import { readFileSync } from "node:fs";
import { Agent } from "node:https";

import type OpenAI from "openai";

import { requireConfig, type LLMConfig } from "../config";
import { OpenAICompatibleAdapter } from "./openai-base";

export class InternalAdapter extends OpenAICompatibleAdapter {
  readonly provider = "internal";
  private readonly endpoint: string;
  private readonly certPath: string;
  private readonly keyPath: string;
  private readonly caPath: string | undefined;

  constructor(cfg: LLMConfig) {
    super(
      requireConfig(
        cfg.INTERNAL_LLM_MODEL,
        "INTERNAL_LLM_MODEL",
        "Set it to the model name your internal serving infrastructure exposes.",
      ),
      cfg.MAX_TOKENS ?? 1024,
      cfg.TEMPERATURE,
    );
    this.endpoint = requireConfig(
      cfg.INTERNAL_LLM_ENDPOINT,
      "INTERNAL_LLM_ENDPOINT",
      "Point it at your internal OpenAI-compatible endpoint, e.g. https://models.agency.gov/v1.",
    );
    this.certPath = requireConfig(
      cfg.INTERNAL_LLM_CERT_PATH,
      "INTERNAL_LLM_CERT_PATH",
      "Path to the client certificate used for mTLS.",
    );
    this.keyPath = requireConfig(
      cfg.INTERNAL_LLM_KEY_PATH,
      "INTERNAL_LLM_KEY_PATH",
      "Path to the private key used for mTLS.",
    );
    this.caPath = cfg.INTERNAL_LLM_CA_PATH;
  }

  protected async createClient(): Promise<OpenAI> {
    const { default: OpenAIClient } = await import("openai");
    const httpAgent = new Agent({
      cert: readFileSync(this.certPath),
      key: readFileSync(this.keyPath),
      ...(this.caPath ? { ca: readFileSync(this.caPath) } : {}),
    });
    // apiKey is unused on an mTLS endpoint but the SDK requires a non-empty value.
    return new OpenAIClient({ baseURL: this.endpoint, apiKey: "mtls", httpAgent });
  }
}
