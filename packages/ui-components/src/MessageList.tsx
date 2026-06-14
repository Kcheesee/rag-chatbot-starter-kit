/**
 * The scrolling list of messages.
 *
 * The container is an `aria-live="polite"` log so new assistant messages are
 * announced to screen readers WITHOUT stealing focus from the input (the WCAG-
 * correct pattern for a chat transcript). New messages auto-scroll into view for
 * sighted users.
 */

import { useEffect, useRef, type CSSProperties, type ReactElement } from "react";

import { Message } from "./Message";
import { TypingIndicator } from "./TypingIndicator";
import type { FeedbackValue, MessageView } from "./types";

export interface MessageListProps {
  messages: MessageView[];
  onFeedback?: (messageId: string, value: FeedbackValue) => void;
  feedbackById?: Record<string, FeedbackValue>;
  bufferMs?: number;
  /** Show the typing indicator (assistant is generating). */
  typing?: boolean;
  typingLabel?: string;
}

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px",
};

export function MessageList({
  messages,
  onFeedback,
  feedbackById,
  bufferMs,
  typing = false,
  typingLabel,
}: MessageListProps): ReactElement {
  const endRef = useRef<HTMLDivElement>(null);

  // Keep the latest message in view as the conversation grows.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, typing]);

  return (
    <div
      style={listStyle}
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Conversation"
    >
      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          feedback={feedbackById?.[message.id] ?? null}
          {...(onFeedback ? { onFeedback: (value) => onFeedback(message.id, value) } : {})}
          {...(bufferMs !== undefined ? { bufferMs } : {})}
        />
      ))}
      {typing ? <TypingIndicator {...(typingLabel ? { label: typingLabel } : {})} /> : null}
      <div ref={endRef} />
    </div>
  );
}
