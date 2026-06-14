/**
 * View types for the chat UI.
 *
 * Deliberately decoupled from `rag-core` — these components are a leaf package with
 * no internal dependencies, so the host app maps its pipeline's `Citation`/response
 * shapes onto these view models. Keeps the components reusable in any host.
 */

export type MessageRole = "user" | "assistant" | "system";

/** Thumbs feedback signal. */
export type FeedbackValue = "up" | "down";

/** A citation as rendered in the UI (mirrors rag-core's Citation). */
export interface CitationView {
  /** 1-based marker matching the `[N]` reference in the answer. */
  index: number;
  sourceFile: string;
  sourceType?: string;
  pageNumber?: number;
  heading?: string;
}

/** A message as rendered in the UI. */
export interface MessageView {
  id: string;
  role: MessageRole;
  content: string;
  citations?: CitationView[];
  /** True while this assistant message is still streaming in. */
  streaming?: boolean;
}

/**
 * Theme overrides, applied as CSS custom properties on the chat root. Keys are CSS
 * variable names (e.g. `--rag-accent`); see `DEFAULT_THEME_VARS` for the full set.
 */
export type Theme = Partial<Record<string, string>>;
