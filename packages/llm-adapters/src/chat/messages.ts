/** Shared helpers for translating our neutral chat shape to provider formats. */

import type { ChatMessage, ChatResponse } from "../types";

/** Provider-agnostic split of a conversation into a system prompt + turns. */
export interface SplitConversation {
  /** Combined system prompt (option system + any system-role messages), or undefined. */
  system: string | undefined;
  /** Non-system turns, in order. */
  turns: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Separate the system prompt from the conversation turns.
 *
 * Anthropic, Bedrock, and Vertex take the system prompt as a top-level field, not
 * an in-array message — so we lift any system-role messages (and the caller's
 * `options.system`) out here. OpenAI-shaped providers re-fold it as the first
 * message themselves.
 */
export function splitConversation(
  messages: ChatMessage[],
  optionSystem: string | undefined,
): SplitConversation {
  const systems = messages.filter((m) => m.role === "system").map((m) => m.content);
  const combined = [optionSystem, ...systems].filter((s): s is string => Boolean(s)).join("\n\n");
  return {
    system: combined.length > 0 ? combined : undefined,
    turns: messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  };
}

/** Normalise an Anthropic-family stop reason to our `ChatResponse.finishReason`. */
export function mapAnthropicStopReason(reason: string | null | undefined): ChatResponse["finishReason"] {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "tool_use";
    case "refusal":
      return "content_filter";
    default:
      return "unknown";
  }
}

/** Normalise an OpenAI-family finish reason to our `ChatResponse.finishReason`. */
export function mapOpenAIFinishReason(reason: string | null | undefined): ChatResponse["finishReason"] {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "content_filter":
      return "content_filter";
    case "tool_calls":
    case "function_call":
      return "tool_use";
    default:
      return "unknown";
  }
}
