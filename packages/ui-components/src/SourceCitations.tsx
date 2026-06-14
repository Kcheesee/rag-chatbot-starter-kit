/**
 * The list of retrieved sources that back an assistant answer.
 *
 * WHY native <details>/<summary>: a disclosure widget must be keyboard-operable,
 * focusable, and announce its expanded/collapsed state to assistive tech. The native
 * element gives all of that for free — re-implementing it on a <div> + click handler
 * would mean re-adding Enter/Space handling, tabindex, and aria-expanded by hand, and
 * getting that subtly wrong. We let the platform own the interaction.
 *
 * WHY descriptive summaries (not a bare "[N]"): the answer body already shows the
 * inline `[N]` markers; this region is where a screen-reader user finds out WHAT each
 * source actually is. A summary of just "[3]" is meaningless out of context, so we
 * build it from the citation metadata — "Source 3: spec.pdf, page 12" — so the label
 * stands on its own (WCAG 2.1 AA: 2.4.6 Headings and Labels, 1.3.1 Info and
 * Relationships). The information lives in the TEXT, never in color alone (1.4.1).
 *
 * WHY a labelled region + semantic list: grouping the sources under a "Sources"
 * heading and a real <ul> lets AT users jump to the region and hear an item count,
 * rather than encountering a loose pile of disclosures.
 *
 * WHY render null when empty: an answer with no retrieved context should produce no
 * "Sources" affordance at all — an empty labelled region is noise for every user.
 */

import { useId } from "react";
import type { CSSProperties, ReactElement } from "react";

import type { CitationView } from "./types";

export interface SourceCitationsProps {
  /** The sources backing the answer, in marker order. Empty renders nothing. */
  citations: CitationView[];
}

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "0.5rem",
};

const cardStyle: CSSProperties = {
  background: "var(--rag-assistant-bg, #f1f3f5)",
  border: "1px solid var(--rag-border, #d0d7de)",
  borderRadius: "var(--rag-radius, 10px)",
  padding: "0.5rem 0.75rem",
};

const summaryStyle: CSSProperties = {
  // Clickable affordance; we deliberately leave the default focus outline in place so
  // keyboard users can see where they are (never `outline: "none"`).
  cursor: "pointer",
  fontWeight: 600,
  color: "var(--rag-assistant-fg, #1a1a1a)",
};

const metaStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  color: "var(--rag-muted, #4b5563)",
  fontSize: "0.875rem",
};

const headingStyle: CSSProperties = {
  margin: "0.5rem 0 0",
  color: "var(--rag-assistant-fg, #1a1a1a)",
  fontSize: "0.9375rem",
};

/**
 * Builds the self-describing summary label from whatever metadata the citation carries.
 * Page number is appended only when present, so we never emit a dangling ", page".
 */
function summaryLabel(citation: CitationView): string {
  const base = `Source ${citation.index}: ${citation.sourceFile}`;
  return citation.pageNumber ? `${base}, page ${citation.pageNumber}` : base;
}

/**
 * Renders one expandable card per source. Returns null (nothing) when there are no
 * citations — see the file-level note on why an empty region is undesirable.
 */
export function SourceCitations({ citations }: SourceCitationsProps): ReactElement | null {
  // Stable id ties the region heading to the list via aria-labelledby, so AT announces
  // the list as the "Sources" group regardless of how many components are mounted.
  const headingId = useId();

  if (citations.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} style={{ margin: "0 0 0.5rem", color: "var(--rag-fg, #1a1a1a)" }}>
        Sources
      </h3>
      <ul aria-labelledby={headingId} style={listStyle}>
        {citations.map((citation) => (
          <li key={citation.index} style={cardStyle}>
            <details>
              {/* Descriptive label built from metadata — not a bare "[N]". */}
              <summary style={summaryStyle}>{summaryLabel(citation)}</summary>
              {citation.heading ? <p style={headingStyle}>{citation.heading}</p> : null}
              {citation.sourceType ? (
                <p style={metaStyle}>Type: {citation.sourceType}</p>
              ) : null}
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
