/**
 * The root chat component — composes the transcript and the composer, and is the
 * themeable boundary.
 *
 * Controlled by design: the host owns `messages` and streaming state and supplies
 * `onSend`/`onFeedback`. That keeps the component reusable across the web app, the
 * widget, and any other host without baking in transport assumptions. The `theme`
 * prop is applied here as CSS custom properties, so every descendant inherits it.
 */

import type { CSSProperties, ReactElement } from "react";

import { themeStyle } from "./theme";
import type { FeedbackValue, MessageView, Theme } from "./types";
import { MessageList } from "./MessageList";
import { ChatInput } from "./ChatInput";

export interface ChatContainerProps {
  messages: MessageView[];
  onSend: (text: string) => void;
  /** Assistant is generating — shows the typing indicator and disables the input. */
  busy?: boolean;
  onFeedback?: (messageId: string, value: FeedbackValue) => void;
  feedbackById?: Record<string, FeedbackValue>;
  /** Brand/theme overrides, applied as CSS variables on the root. */
  theme?: Theme;
  bufferMs?: number;
  title?: string;
  placeholder?: string;
}

export function ChatContainer({
  messages,
  onSend,
  busy = false,
  onFeedback,
  feedbackById,
  theme,
  bufferMs,
  title,
  placeholder,
}: ChatContainerProps): ReactElement {
  const rootStyle: CSSProperties = {
    ...themeStyle(theme),
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--rag-bg, #ffffff)",
    color: "var(--rag-fg, #1a1a1a)",
    fontFamily: "var(--rag-font, system-ui, sans-serif)",
  };

  return (
    <div style={rootStyle}>
      {title ? (
        <header
          style={{
            padding: "12px 16px",
            borderBottom: "1px solid var(--rag-border, #d0d7de)",
            fontWeight: 600,
          }}
        >
          <h2 style={{ margin: 0, fontSize: "1rem" }}>{title}</h2>
        </header>
      ) : null}

      <MessageList
        messages={messages}
        typing={busy}
        {...(onFeedback ? { onFeedback } : {})}
        {...(feedbackById ? { feedbackById } : {})}
        {...(bufferMs !== undefined ? { bufferMs } : {})}
      />

      <div style={{ borderTop: "1px solid var(--rag-border, #d0d7de)", padding: "12px 16px" }}>
        <ChatInput
          onSend={onSend}
          disabled={busy}
          {...(placeholder ? { placeholder } : {})}
        />
      </div>
    </div>
  );
}
