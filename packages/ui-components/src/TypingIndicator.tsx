import { useId } from "react";
import type { ReactElement } from "react";

import { srOnly } from "./theme";

/** Props for {@link TypingIndicator}. */
export interface TypingIndicatorProps {
  /** Accessible text announced by screen readers. Also conveys the state non-visually. */
  label?: string;
}

/**
 * Shows that the assistant is composing a reply.
 *
 * WHY this shape:
 * - During streaming there's a gap between "request sent" and "first token". A visible
 *   indicator reassures sighted users that work is happening, while a polite live region
 *   announces the same fact to screen-reader users without stealing focus.
 * - The pulsing dots are decoration only — they carry no semantic meaning and are hidden
 *   from assistive tech (`aria-hidden`). The state is conveyed by the visually-hidden
 *   {@link TypingIndicatorProps.label} text, so meaning never depends on color or motion
 *   alone (WCAG 2.1 AA: 1.4.1 Use of Color, 1.4.13 / status messaging via 4.1.3).
 * - Keyframes can't be expressed inline, so a single module-scoped `<style>` block defines
 *   the animation, scoped by a stable class name. A `prefers-reduced-motion` query disables
 *   the motion for users who request it (WCAG 2.3.3 Animation from Interactions).
 */
export function TypingIndicator({
  label = "Assistant is typing…",
}: TypingIndicatorProps): ReactElement {
  // Stable id keeps the keyframes name from colliding if multiple indicators mount.
  const rawId = useId();
  const keyframes = `rag-typing-pulse-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const css = `
.rag-typing-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin: 0 2px;
  border-radius: 50%;
  background: var(--rag-muted, #4b5563);
  animation: ${keyframes} 1.2s ease-in-out infinite;
}
.rag-typing-dot:nth-child(2) { animation-delay: 0.15s; }
.rag-typing-dot:nth-child(3) { animation-delay: 0.3s; }
@keyframes ${keyframes} {
  0%, 60%, 100% { opacity: 0.3; transform: translateY(0); }
  30% { opacity: 1; transform: translateY(-3px); }
}
@media (prefers-reduced-motion: reduce) {
  .rag-typing-dot { animation: none; }
}
`;

  return (
    <span role="status" aria-live="polite" style={{ display: "inline-flex", alignItems: "center" }}>
      <style>{css}</style>
      <span aria-hidden="true" style={{ display: "inline-flex", alignItems: "center" }}>
        <span className="rag-typing-dot" />
        <span className="rag-typing-dot" />
        <span className="rag-typing-dot" />
      </span>
      <span style={srOnly}>{label}</span>
    </span>
  );
}
