/**
 * Thumbs up/down feedback control for an assistant answer.
 *
 * WHY native <button>: native buttons are keyboard-operable, focusable, and announced
 * as buttons for free — re-implementing this on a <div role="button"> would mean
 * re-adding Enter/Space handling and tabindex by hand, and getting it subtly wrong.
 *
 * WHY controlled (value prop, no internal state): the host owns the feedback record
 * (it persists it, may revert on a failed save, or hydrate from history). Keeping this
 * stateless avoids the selected glyph drifting out of sync with what was actually stored.
 *
 * WHY redundant selection cues: WCAG 2.1 AA (1.4.1 Use of Color) forbids conveying state
 * by color alone. Selection is therefore signalled three ways — `aria-pressed` (for AT),
 * a FILLED glyph variant (▲/△, perceivable without color), and accent color (secondary).
 */

import type { ReactElement } from "react";

import type { FeedbackValue } from "./types";

export interface FeedbackButtonsProps {
  /** Currently recorded feedback, or null/undefined when none has been given. */
  value?: FeedbackValue | null;
  /** Invoked with the chosen value when the user clicks a thumb. */
  onFeedback: (value: FeedbackValue) => void;
}

/**
 * Renders the two-button feedback group. Selection is reflected via `value`; the
 * component holds no state of its own (see file-level note on the controlled pattern).
 */
export function FeedbackButtons({ value, onFeedback }: FeedbackButtonsProps): ReactElement {
  const upSelected = value === "up";
  const downSelected = value === "down";

  return (
    <div role="group" aria-label="Was this answer helpful?">
      <button
        type="button"
        aria-label="Helpful"
        aria-pressed={upSelected}
        onClick={() => onFeedback("up")}
        // Color is the SECONDARY cue; the filled glyph + aria-pressed are primary.
        style={{ color: upSelected ? "var(--rag-accent, #1d4ed8)" : "var(--rag-muted, #4b5563)" }}
      >
        {/* Filled (▲) when selected, outline (△) otherwise — perceivable without color. */}
        <span aria-hidden="true">{upSelected ? "▲" : "△"}</span>
      </button>
      <button
        type="button"
        aria-label="Not helpful"
        aria-pressed={downSelected}
        onClick={() => onFeedback("down")}
        style={{ color: downSelected ? "var(--rag-accent, #1d4ed8)" : "var(--rag-muted, #4b5563)" }}
      >
        {/* Filled (▼) when selected, outline (▽) otherwise. */}
        <span aria-hidden="true">{downSelected ? "▼" : "▽"}</span>
      </button>
    </div>
  );
}
