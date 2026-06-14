/**
 * Streams assistant text with two audiences in mind.
 *
 * Sighted users want to watch tokens land the instant they arrive, so the visible
 * element re-renders the full accumulated `text` every pass. Screen-reader users,
 * however, are overwhelmed by token-by-token announcements: an `aria-live` region
 * fires a fresh announcement on every content change, which during streaming means
 * dozens of interruptions a second — completely unusable. So we decouple the two:
 * the visible pane updates live, while a separate visually-hidden live region only
 * announces NEWLY-COMPLETED, sentence-aligned chunks.
 *
 * The announce strategy, in priority order:
 *  1. Sentence boundary — announce up to and including the last complete sentence
 *     at/after the announced offset (a natural, listenable unit).
 *  2. Debounce flush — if text keeps growing but no sentence boundary appears within
 *     `bufferMs`, flush the pending tail anyway so non-sentence content (lists, code,
 *     a trailing fragment) is eventually spoken.
 *  3. End-of-stream flush — when `streaming` flips to false, flush everything left
 *     immediately so nothing is silently dropped.
 *
 * An offset ref records how much text has already been announced. Keying all work off
 * that ref makes the effect idempotent, which matters under React 18 StrictMode where
 * effects mount/run twice: a duplicate pass sees the offset already advanced and emits
 * nothing, so no sentence is announced twice.
 */

import { useEffect, useRef, useState, type ReactElement } from "react";

import { srOnly } from "./theme";

export interface StreamingTextProps {
  /** Full accumulated assistant text so far (not just the latest token). */
  text: string;
  /** True while tokens are still arriving; false once the stream has ended. */
  streaming?: boolean;
  /** Debounce window (ms) before flushing pending non-sentence content. Default 500. */
  bufferMs?: number;
}

/**
 * Matches a sentence terminator (. ! ?) followed by whitespace or end-of-string.
 * Used to find the end of the last *complete* sentence in the unannounced tail.
 */
const SENTENCE_BOUNDARY = /[.!?](\s|$)/g;

/**
 * Index just past the last complete sentence in `slice`, or -1 if none.
 * Scans all boundaries and keeps the furthest so we announce as much as is ready.
 */
function lastSentenceEnd(slice: string): number {
  SENTENCE_BOUNDARY.lastIndex = 0;
  let end = -1;
  let match: RegExpExecArray | null = SENTENCE_BOUNDARY.exec(slice);
  while (match !== null) {
    // Include the terminator; the trailing whitespace (if any) is left for the next slice.
    end = match.index + 1;
    match = SENTENCE_BOUNDARY.exec(slice);
  }
  return end;
}

export function StreamingText({
  text,
  streaming = false,
  bufferMs = 500,
}: StreamingTextProps): ReactElement {
  // How many characters of `text` have already been announced to screen readers.
  const announcedOffsetRef = useRef<number>(0);
  // The latest flushed delta — set as the live region's content so each flush
  // produces exactly one announcement of only the new chunk.
  const [liveMessage, setLiveMessage] = useState<string>("");

  useEffect(() => {
    const offset = announcedOffsetRef.current;

    // Guard against a `text` that shrank or reset (e.g. a new message replaced the
    // old one): clamp the offset so we never slice with a stale, too-large index.
    if (offset > text.length) {
      announcedOffsetRef.current = text.length;
      return;
    }

    const pending = text.slice(offset);
    if (pending.length === 0) {
      return;
    }

    /** Commit `count` chars from the pending tail as announced. */
    const flush = (count: number): void => {
      if (count <= 0) {
        return;
      }
      const chunk = pending.slice(0, count);
      announcedOffsetRef.current = offset + count;
      setLiveMessage(chunk);
    };

    // 3. Stream ended: announce the entire remaining tail right away.
    if (!streaming) {
      flush(pending.length);
      return;
    }

    // 1. Sentence boundary available: announce through the last complete sentence.
    const end = lastSentenceEnd(pending);
    if (end >= 0) {
      flush(end);
      return;
    }

    // 2. No boundary yet: debounce, then flush whatever has accumulated by then.
    //    Re-reading the ref inside the timer keeps it consistent if an earlier
    //    sentence flush advanced the offset before this timer fired.
    const timer = setTimeout(() => {
      const latestOffset = announcedOffsetRef.current;
      const tail = text.slice(latestOffset);
      if (tail.length > 0) {
        announcedOffsetRef.current = latestOffset + tail.length;
        setLiveMessage(tail);
      }
    }, bufferMs);

    return () => {
      clearTimeout(timer);
    };
  }, [text, streaming, bufferMs]);

  return (
    <span style={{ color: "var(--rag-fg, #1a1a1a)" }}>
      {/* Visible pane: updates every render so sighted users see tokens live. */}
      <span aria-hidden="true">{text}</span>
      {/* Screen-reader pane: announces only buffered, newly-completed chunks. */}
      <span style={srOnly} aria-live="polite" aria-atomic="true">
        {liveMessage}
      </span>
    </span>
  );
}
