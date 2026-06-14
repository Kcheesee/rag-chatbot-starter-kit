"use client";

import type { ReactElement } from "react";

import { ChatContainer } from "@rag-chat-agent/ui-components";

import { useChat } from "./use-chat";

export default function Page(): ReactElement {
  const { messages, busy, feedbackById, send, feedback } = useChat("default");

  return (
    <main style={{ height: "100dvh", maxWidth: 820, margin: "0 auto" }}>
      <ChatContainer
        title="RAG Chat Agent"
        messages={messages}
        onSend={send}
        busy={busy}
        onFeedback={feedback}
        feedbackById={feedbackById}
        placeholder="Ask about the knowledge base…"
      />
    </main>
  );
}
