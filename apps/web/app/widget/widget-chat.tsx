"use client";

import type { ReactElement } from "react";

import { ChatContainer, type Theme } from "@rag-chat-agent/ui-components";

import { useChat } from "../use-chat";

export interface WidgetChatProps {
  name: string;
  color: string;
}

/** The embeddable chat surface rendered inside the widget iframe, themed per host. */
export function WidgetChat({ name, color }: WidgetChatProps): ReactElement {
  const { messages, busy, feedbackById, send, feedback } = useChat("default");
  const theme: Theme = {
    "--rag-accent": color,
    "--rag-user-bg": color,
    "--rag-focus": color,
  };

  return (
    <div style={{ height: "100dvh" }}>
      <ChatContainer
        title={name}
        messages={messages}
        onSend={send}
        busy={busy}
        onFeedback={feedback}
        feedbackById={feedbackById}
        theme={theme}
        placeholder="Ask a question…"
      />
    </div>
  );
}
