/**
 * Azure OpenAI adapters — commercial (Tier 2) and Government (Tier 3).
 *
 * Auth is key-or-identity: if `AZURE_OPENAI_API_KEY` is set (e.g. injected from Key
 * Vault) it's used directly; otherwise the adapter falls back to Managed Identity
 * via `DefaultAzureCredential`, so no static secret lives in the environment. The
 * `model` passed to the OpenAI-compatible base is the Azure *deployment* name.
 */

import type OpenAI from "openai";

import { requireConfig, type LLMConfig } from "../config";
import { OpenAICompatibleAdapter } from "./openai-base";

abstract class AbstractAzureAdapter extends OpenAICompatibleAdapter {
  protected readonly endpoint: string;
  protected readonly apiVersion: string;
  protected readonly deployment: string;
  protected readonly apiKey: string | undefined;

  constructor(cfg: LLMConfig) {
    const deployment = requireConfig(
      cfg.AZURE_OPENAI_DEPLOYMENT,
      "AZURE_OPENAI_DEPLOYMENT",
      "Set it to your Azure OpenAI deployment name (your platform team owns this).",
    );
    super(deployment, cfg.MAX_TOKENS ?? 1024, cfg.TEMPERATURE);
    this.deployment = deployment;
    this.endpoint = requireConfig(
      cfg.AZURE_OPENAI_ENDPOINT,
      "AZURE_OPENAI_ENDPOINT",
      "Set it to your Azure OpenAI resource endpoint.",
    );
    this.apiVersion = cfg.AZURE_OPENAI_API_VERSION ?? "2024-08-01-preview";
    this.apiKey = cfg.AZURE_OPENAI_API_KEY;
  }

  /** AAD scope differs between commercial and Government clouds. */
  protected get aadScope(): string {
    return this.endpoint.includes(".azure.us")
      ? "https://cognitiveservices.azure.us/.default"
      : "https://cognitiveservices.azure.com/.default";
  }

  protected async createClient(): Promise<OpenAI> {
    const { AzureOpenAI } = await import("openai");
    const base = { endpoint: this.endpoint, apiVersion: this.apiVersion, deployment: this.deployment };

    if (this.apiKey) {
      return new AzureOpenAI({ ...base, apiKey: this.apiKey });
    }

    // No static key — authenticate with Managed Identity / workload identity.
    const { DefaultAzureCredential, getBearerTokenProvider } = await import("@azure/identity");
    const azureADTokenProvider = getBearerTokenProvider(new DefaultAzureCredential(), this.aadScope);
    return new AzureOpenAI({ ...base, azureADTokenProvider });
  }
}

/** Azure OpenAI Service (commercial). */
export class AzureOpenAIAdapter extends AbstractAzureAdapter {
  readonly provider = "azure-openai";
}

/** Azure Government — same as commercial, but the endpoint must be a `.azure.us` one. */
export class AzureGovAdapter extends AbstractAzureAdapter {
  readonly provider = "azure-gov";

  constructor(cfg: LLMConfig) {
    super(cfg);
    if (!this.endpoint.includes(".azure.us")) {
      throw new Error(
        `LLM_PROVIDER="azure-gov" requires an Azure Government endpoint (*.openai.azure.us). ` +
          `Got: "${this.endpoint}". See CONFIG.md#federal-deployment.`,
      );
    }
  }
}
