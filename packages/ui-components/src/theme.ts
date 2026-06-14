/**
 * Theming via CSS custom properties.
 *
 * Components reference `var(--rag-*)` with fallbacks, so they render correctly with
 * no theme at all; an agency overrides any subset by passing a `theme` prop, which
 * is applied as inline CSS variables on the chat root. Defaults are chosen to meet
 * WCAG 2.1 AA contrast (≥ 4.5:1 for text).
 */

import type { CSSProperties } from "react";

import type { Theme } from "./types";

/** Default CSS variables. All text/background pairs clear 4.5:1 contrast. */
export const DEFAULT_THEME_VARS: Record<string, string> = {
  "--rag-bg": "#ffffff",
  "--rag-fg": "#1a1a1a", // ~15:1 on white
  "--rag-user-bg": "#1d4ed8", // blue-700
  "--rag-user-fg": "#ffffff", // ~6:1 on blue-700
  "--rag-assistant-bg": "#f1f3f5",
  "--rag-assistant-fg": "#1a1a1a",
  "--rag-accent": "#1d4ed8",
  "--rag-focus": "#1d4ed8",
  "--rag-border": "#d0d7de",
  "--rag-muted": "#4b5563", // gray-600, ~7:1 on white
  "--rag-danger": "#b91c1c", // red-700, ~6:1 on white
  "--rag-radius": "10px",
  "--rag-font": "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
};

/** Build the root style object: defaults overlaid with any theme overrides. */
export function themeStyle(theme?: Theme): CSSProperties {
  return { ...DEFAULT_THEME_VARS, ...(theme ?? {}) } as CSSProperties;
}

/**
 * Visually-hidden style for screen-reader-only content (e.g. aria-live regions that
 * announce without being shown). Stays in the accessibility tree; removed visually.
 */
export const srOnly: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};
