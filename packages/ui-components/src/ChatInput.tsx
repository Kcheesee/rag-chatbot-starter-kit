import { useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, ReactElement } from "react";

/** Props for {@link ChatInput}. */
export interface ChatInputProps {
  /** Called with the trimmed message text when the user submits a non-empty composer. */
  onSend: (text: string) => void;
  /**
   * Locks the composer while a request is in flight. WHY: sending a second message
   * before the first resolves can race the conversation state, so the host disables
   * input during streaming rather than queueing.
   */
  disabled?: boolean;
  /** Placeholder shown while the textarea is empty. */
  placeholder?: string;
}

/**
 * The message composer at the foot of the chat.
 *
 * WHY this shape:
 * - A real `<form>` (not a click handler on a `<div>`) gives us submit semantics for
 *   free: the button is `type="submit"`, so Enter, click, and assistive-tech activation
 *   all route through one `onSubmit` path — keyboard and pointer users stay in sync and
 *   the send action is reachable without any custom key wiring (WCAG 2.1.1 Keyboard).
 * - Enter-to-send with Shift+Enter-for-newline matches chat conventions. We intercept on
 *   the textarea's `onKeyDown` and call `requestSubmit()` so the native submit pipeline —
 *   including the trim/empty guard in {@link handleSubmit} — runs exactly once, instead of
 *   duplicating that logic in the key handler.
 * - The textarea is controlled via `useState` so the submit guard can inspect the current
 *   value, and so we can clear it deterministically after a successful send.
 * - After sending we refocus the textarea (via a ref): the user almost always types again,
 *   and returning focus avoids a jarring focus-loss that would otherwise force keyboard and
 *   screen-reader users to re-navigate back to the composer.
 * - The textarea carries `aria-label="Message"` so it has an accessible name without a
 *   visible label cluttering the composer (WCAG 4.1.2 Name, Role, Value). The send button
 *   gets `aria-label="Send message"` because its only visible content is a glyph.
 * - Colors come from `var(--rag-*)` with fallbacks so the component renders with no theme,
 *   and default focus outlines are preserved (never `outline: none`) for 2.4.7 Focus Visible.
 */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = "Ask a question…",
}: ChatInputProps): ReactElement {
  const [value, setValue] = useState<string>("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Single source of truth for "can this be sent": drives both the submit guard and the
  // button's disabled state, so the UI affordance and the behavior can never disagree.
  const trimmed = value.trim();
  const canSend = trimmed.length > 0 && !disabled;

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    // Stop the browser's default full-page navigation; this is a client-side action.
    event.preventDefault();
    if (!canSend) {
      return;
    }
    onSend(trimmed);
    setValue("");
    // Keep the composer focused for the next message (see component JSDoc).
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter falls through to insert a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      // Route through the form so the trim/empty guard runs in exactly one place.
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 8,
        padding: 8,
        font: "var(--rag-font, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif)",
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label="Message"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        style={{
          flex: 1,
          resize: "none",
          padding: "8px 10px",
          color: "var(--rag-fg, #1a1a1a)",
          background: "var(--rag-bg, #ffffff)",
          border: "1px solid var(--rag-border, #d0d7de)",
          borderRadius: "var(--rag-radius, 10px)",
          font: "inherit",
          lineHeight: 1.4,
        }}
      />
      <button
        type="submit"
        aria-label="Send message"
        disabled={!canSend}
        style={{
          flex: "0 0 auto",
          padding: "8px 14px",
          color: "#ffffff",
          background: "var(--rag-accent, #1d4ed8)",
          border: "1px solid transparent",
          borderRadius: "var(--rag-radius, 10px)",
          font: "inherit",
          fontWeight: 600,
          // Communicate the locked state without relying on color alone (WCAG 1.4.1).
          cursor: canSend ? "pointer" : "not-allowed",
          opacity: canSend ? 1 : 0.6,
        }}
      >
        Send
      </button>
    </form>
  );
}
