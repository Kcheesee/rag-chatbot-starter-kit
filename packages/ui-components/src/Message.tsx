/**
 * A single chat message bubble (user / assistant / system).
 *
 * Assistant content renders through `StreamingText` so screen-reader announcements
 * are sentence-buffered even for already-complete messages; user content is shown
 * verbatim (the user typed it — no need to announce it back). A visually-hidden
 * speaker label gives screen-reader users the role of each message without relying
 * on visual alignment/colour alone.
 */

import type { CSSProperties, ReactElement } from "react";

import { srOnly } from "./theme";
import type { FeedbackValue, MessageView } from "./types";
import { StreamingText } from "./StreamingText";
import { SourceCitations } from "./SourceCitations";
import { FeedbackButtons } from "./FeedbackButtons";

export interface MessageProps {
  message: MessageView;
  /** Current feedback selection for this message, if any. */
  feedback?: FeedbackValue | null;
  /** When provided, assistant messages show thumbs up/down. */
  onFeedback?: (value: FeedbackValue) => void;
  /** Screen-reader announcement buffer for streaming assistant text. */
  bufferMs?: number;
}

const bubbleBase: CSSProperties = {
  maxWidth: "85%",
  padding: "10px 14px",
  borderRadius: "var(--rag-radius, 10px)",
  lineHeight: 1.5,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

export function Message({ message, feedback, onFeedback, bufferMs }: MessageProps): ReactElement {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";

  const rowStyle: CSSProperties = {
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
    margin: "8px 0",
  };

  const bubbleStyle: CSSProperties = {
    ...bubbleBase,
    background: isUser
      ? "var(--rag-user-bg, #1d4ed8)"
      : isSystem
        ? "transparent"
        : "var(--rag-assistant-bg, #f1f3f5)",
    color: isUser
      ? "var(--rag-user-fg, #ffffff)"
      : isSystem
        ? "var(--rag-muted, #4b5563)"
        : "var(--rag-assistant-fg, #1a1a1a)",
    fontStyle: isSystem ? "italic" : "normal",
  };

  const speaker = isUser ? "You said:" : isSystem ? "System:" : "Assistant said:";

  return (
    <div style={rowStyle}>
      <div style={bubbleStyle}>
        <span style={srOnly}>{speaker}</span>
        {isUser || isSystem ? (
          <span>{message.content}</span>
        ) : (
          <>
            <StreamingText
              text={message.content}
              streaming={message.streaming ?? false}
              {...(bufferMs !== undefined ? { bufferMs } : {})}
            />
            {message.citations && message.citations.length > 0 ? (
              <SourceCitations citations={message.citations} />
            ) : null}
            {onFeedback ? (
              <FeedbackButtons value={feedback ?? null} onFeedback={onFeedback} />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
