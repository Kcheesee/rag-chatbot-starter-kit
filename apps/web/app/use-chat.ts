"use client";

import { useCallback, useRef, useState } from "react";

import type { CitationView, FeedbackValue, MessageView } from "@rag-chat-agent/ui-components";

/**
 * Client chat hook shared by the main page and the embeddable widget page.
 *
 * Owns the conversation state and the `/api/chat` ndjson streaming read, decoded
 * into a live assistant message. Declared here (not in a server module) so it stays
 * free of any `rag-core` import — the browser only speaks the API's wire contract.
 */

interface SourceLike {
  index: number;
  sourceFile: string;
  sourceType?: string;
  pageNumber?: number;
  heading?: string;
}
type StreamChunk =
  | { type: "token"; token: string }
  | { type: "sources"; sources: SourceLike[] }
  | { type: "done" }
  | { type: "error"; error: string };

function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function toCitationViews(sources: SourceLike[]): CitationView[] {
  return sources.map((s) => ({
    index: s.index,
    sourceFile: s.sourceFile,
    ...(s.sourceType ? { sourceType: s.sourceType } : {}),
    ...(s.pageNumber !== undefined ? { pageNumber: s.pageNumber } : {}),
    ...(s.heading ? { heading: s.heading } : {}),
  }));
}

export interface UseChat {
  messages: MessageView[];
  busy: boolean;
  feedbackById: Record<string, FeedbackValue>;
  send: (text: string) => Promise<void>;
  feedback: (messageId: string, value: FeedbackValue) => void;
}

export function useChat(namespace: string): UseChat {
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [busy, setBusy] = useState(false);
  const [feedbackById, setFeedbackById] = useState<Record<string, FeedbackValue>>({});
  const sessionId = useRef<string>(newId());

  const send = useCallback(
    async (text: string) => {
      const assistantId = newId();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "user", content: text },
        { id: assistantId, role: "assistant", content: "", streaming: true },
      ]);
      setBusy(true);

      const patch = (content: string, citations: CitationView[], streaming: boolean): void =>
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantId ? { ...m, content, citations, streaming } : m)),
        );

      let answer = "";
      let citations: CitationView[] = [];
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: text, sessionId: sessionId.current, namespace }),
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status}).`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim().length === 0) continue;
            const chunk = JSON.parse(line) as StreamChunk;
            if (chunk.type === "token") answer += chunk.token;
            else if (chunk.type === "sources") citations = toCitationViews(chunk.sources);
            else if (chunk.type === "error") answer += `\n\n_(error: ${chunk.error})_`;
            patch(answer, citations, true);
          }
        }
        patch(answer, citations, false);
      } catch {
        patch(answer || "Sorry — something went wrong reaching the assistant.", citations, false);
      } finally {
        setBusy(false);
      }
    },
    [namespace],
  );

  const feedback = useCallback(
    (messageId: string, value: FeedbackValue): void => {
      setFeedbackById((prev) => ({ ...prev, [messageId]: value }));
      void fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: sessionId.current, messageId, value, namespace }),
      }).catch(() => undefined);
    },
    [namespace],
  );

  return { messages, busy, feedbackById, send, feedback };
}
