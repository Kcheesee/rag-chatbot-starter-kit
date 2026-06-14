# Voluntary Product Accessibility Template (VPAT)

**VPAT 2.x-style accessibility conformance report**

| Field | Value |
| --- | --- |
| **Name of Product / Version** | rag-chat-agent chat UI (`@rag-chat-agent/ui-components`) |
| **Report Date** | 2026-06-14 |
| **Product Description** | Embeddable React chat interface for a Retrieval-Augmented Generation (RAG) assistant. Renders a streaming conversation transcript, source citations, a typing indicator, a message composer, and thumbs up/down feedback controls. |
| **Contact Information** | accessibility contact — kareem.o.primo@gmail.com |
| **Notes** | This report covers the **chat UI components only** (`packages/ui-components/src/*.tsx`). It does not cover the surrounding host application chrome (navigation, authentication, agency-supplied page shell), which each integrator must evaluate separately. |
| **Evaluation Methods Used** | Manual source-code inspection of the React components against each success criterion; review of rendered DOM semantics, ARIA roles/states, and the default theme color tokens (`theme.ts`). **No automated tooling (e.g. axe-core) or live assistive-technology testing was performed for this report** — claims reflect implemented markup and behavior, not a verified runtime audit. See the Notes section. |

---

## Applicable Standards / Guidelines

This report documents conformance against the following standard:

| Standard / Guideline | Included in Report |
| --- | --- |
| Web Content Accessibility Guidelines (WCAG) 2.1 | **Level A** (Yes), **Level AA** (Yes), Level AAA (No) |

**Target note.** Section 508 (Revised 508 Standards, 36 CFR Part 1194) legally incorporates **WCAG 2.0 Level AA** as the baseline. This product deliberately targets **WCAG 2.1 Level AA**, which is a strict superset of 2.0 AA — meeting 2.1 AA satisfies the 2.0 AA legal baseline and additionally addresses the 2.1 criteria (1.3.4, 1.3.5, 1.4.10–1.4.13, 2.5.x, 4.1.3) that agencies increasingly request even though 2.1 is not yet codified in the Revised 508 Standards.

---

## Conformance Level Key

| Term | Meaning |
| --- | --- |
| **Supports** | The functionality of the product has at least one method that meets the criterion without known defects, or meets it with equivalent facilitation. |
| **Partially Supports** | Some functionality of the product does not meet the criterion. |
| **Does Not Support** | The majority of product functionality does not meet the criterion. |
| **Not Applicable** | The criterion is not relevant to the product (the product has no content of the type the criterion addresses). |

---

## WCAG 2.x Report

The two tables below report each Level A (Table 1) and Level AA (Table 2) success criterion, with the assessed conformance level and remarks specific to this chat UI implementation.

### Table 1: Success Criteria, Level A

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.1.1 Non-text Content** | Supports | The only non-text content is decorative. The typing-indicator dots are `aria-hidden="true"` (`TypingIndicator`), and the feedback glyphs (▲/△, ▼/▽) are wrapped in `aria-hidden` spans while the buttons carry text `aria-label`s ("Helpful" / "Not helpful"). No informational images are rendered by the component set. |
| **1.2.1 Audio-only and Video-only (Prerecorded)** | Not Applicable | The chat UI contains no prerecorded audio-only or video-only media. |
| **1.2.2 Captions (Prerecorded)** | Not Applicable | The chat UI contains no synchronized prerecorded media. |
| **1.2.3 Audio Description or Media Alternative (Prerecorded)** | Not Applicable | The chat UI contains no prerecorded synchronized media. |
| **1.3.1 Info and Relationships** | Supports | Structure and relationships are conveyed semantically: the transcript is `role="log"` (`MessageList`); the typing indicator is `role="status"` (`TypingIndicator`); citations use native `<details>`/`<summary>` inside a labelled `<section>` with an `<h3>` heading and a real `<ul>`/`<li>` list (`SourceCitations`); the composer is a native `<form>` with `<textarea>` and submit `<button>` (`ChatInput`); feedback uses a `role="group"` with an accessible group label (`FeedbackButtons`). A visually-hidden speaker label ("You said:" / "Assistant said:" / "System:") precedes each message body (`Message`), so role is not conveyed by visual alignment/color alone. |
| **1.3.2 Meaningful Sequence** | Supports | DOM order matches reading order: speaker label, then message content, then citations, then feedback. The visible streaming pane and the screen-reader announcement region appear in a logical order within `StreamingText`. |
| **1.3.3 Sensory Characteristics** | Supports | No instructions rely on shape, size, visual location, or sound. Controls are identified by their text accessible names ("Send message", "Helpful", "Not helpful"). |
| **1.4.1 Use of Color** | Supports | State is never conveyed by color alone. Feedback selection is signalled three ways — `aria-pressed`, a filled-vs-outline glyph (▲/△), and accent color as a secondary cue (`FeedbackButtons`). The disabled Send button uses `cursor: not-allowed` and reduced `opacity` plus the native `disabled` state, not color alone (`ChatInput`). Message roles carry a visually-hidden text label, not just color/position (`Message`). |
| **1.4.2 Audio Control** | Not Applicable | The chat UI plays no audio automatically (or at all). |
| **2.1.1 Keyboard** | Supports | All interactive elements are native, keyboard-operable controls: `<textarea>` and submit `<button>` (`ChatInput`), native `<button>` feedback controls (`FeedbackButtons`), and native `<details>`/`<summary>` disclosures for citations (`SourceCitations`). Enter sends the message, Shift+Enter inserts a newline, routed through `form.requestSubmit()`. No custom key handling is required to operate any control. |
| **2.1.2 No Keyboard Trap** | Supports | All controls are standard focusable elements with no focus-management code that would retain focus. After a successful send, focus is returned to the composer textarea (a deliberate, non-trapping focus move); users can Tab away freely at any time. |
| **2.1.4 Character Key Shortcuts** | Not Applicable | The component implements no single-character key shortcuts. Enter/Shift+Enter are standard text-field activation keys, not single-character shortcut bindings, so this criterion does not apply. |
| **2.2.1 Timing Adjustable** | Not Applicable | No time limits are imposed on the user by the UI. The streaming announcement buffer (`bufferMs`, default 500 ms) governs how soon the system speaks new content; it places no time limit on user actions. |
| **2.2.2 Pause, Stop, Hide** | Supports | The only moving content is the typing-indicator dot animation. It is purely decorative and `aria-hidden`, lasts only while the assistant is generating, and is fully disabled under `prefers-reduced-motion: reduce` (`TypingIndicator`). |
| **2.3.1 Three Flashes or Below Threshold** | Supports | No content flashes. The typing-indicator pulse is a slow (1.2 s) opacity/translate ease, far below three flashes per second. |
| **2.4.1 Bypass Blocks** | Not Applicable | The component is a single embedded widget, not a full page; it defines no repeated page-level navigation blocks. Providing skip mechanisms for surrounding repeated content is the responsibility of the host page. |
| **2.4.2 Page Titled** | Not Applicable | Page-level `<title>` is owned by the host application, not by this embeddable component. (The optional `title` prop renders an in-widget `<h2>` heading, which supports 2.4.6 / 1.3.1 rather than 2.4.2.) |
| **2.4.3 Focus Order** | Supports | Tab order follows DOM/reading order. Within an assistant message, focus moves through citation disclosures and then the feedback buttons; the composer follows the transcript. Post-send focus return to the composer preserves a sensible order for the next message. |
| **2.4.4 Link Purpose (In Context)** | Not Applicable | The component renders no hyperlinks. Citation disclosures are `<summary>` controls with self-describing labels ("Source 3: spec.pdf, page 12"), evaluated under 2.4.6, not 2.4.4. |
| **2.5.1 Pointer Gestures** | Supports | All operations use single-point activation (click/tap, Enter). No path-based or multipoint gestures are required. |
| **2.5.2 Pointer Cancellation** | Supports | Activation uses native `click`/form-submit semantics, which fire on the up-event and are cancellable by moving off the target before release. No down-event activation is implemented. |
| **2.5.3 Label in Name** | Supports | Where a control has visible text, the accessible name includes it: the Send button's visible text is "Send" and its `aria-label` is "Send message" (the visible word is contained in the name). Icon-only controls (feedback thumbs) have no visible text label, so there is no mismatch to violate this criterion. |
| **2.5.4 Motion Actuation** | Not Applicable | No functionality is operated by device or user motion. |
| **3.1.1 Language of Page** | Not Applicable | The document `lang` attribute is owned by the host page. The component emits no `lang` declaration of its own. |
| **3.2.1 On Focus** | Supports | Focusing any control (textarea, buttons, disclosures) triggers no change of context. |
| **3.2.2 On Input** | Supports | Typing in the textarea does not auto-submit or change context; submission requires an explicit Enter or Send activation. Toggling feedback or a disclosure changes only that control's own state, not context. |
| **3.3.1 Error Identification** | Supports (by design / not applicable to component scope) | The composer performs only an empty/whitespace guard, which it surfaces by disabling the Send button rather than by producing an error message — so there is no error text to identify. Application-level errors (network/LLM failures) are rendered by the host as system messages and are out of this component's scope. |
| **3.3.2 Labels or Instructions** | Supports | The textarea has `aria-label="Message"` and a visible placeholder; the Send button is labelled "Send message"; feedback buttons are labelled "Helpful"/"Not helpful" inside a labelled group; the citations region has a "Sources" heading. |
| **4.1.1 Parsing** | Supports | Markup is generated by React from well-formed JSX with valid nesting (`<section>`>`<ul>`>`<li>`>`<details>`). (Note: WCAG 2.1 has formally deprecated 4.1.1; reported here as Supports for completeness.) |
| **4.1.2 Name, Role, Value** | Supports | All controls expose correct name, role, and value: native `<button>`/`<textarea>`/`<details>` provide their roles automatically; icon-only buttons carry `aria-label`; feedback buttons expose selection via `aria-pressed`; the feedback group uses `role="group"` with `aria-label`; the citations region uses `aria-labelledby` tying the list to its heading. |

### Table 2: Success Criteria, Level AA

| Criterion | Conformance Level | Remarks and Explanations |
| --- | --- | --- |
| **1.2.4 Captions (Live)** | Not Applicable | The chat UI contains no live synchronized media. |
| **1.2.5 Audio Description (Prerecorded)** | Not Applicable | The chat UI contains no prerecorded synchronized media. |
| **1.3.4 Orientation** | Supports | The layout uses flexbox with relative sizing and no orientation lock; it renders in both portrait and landscape. |
| **1.3.5 Identify Input Purpose** | Not Applicable | The composer collects free-form message text, which is not one of the WCAG input-purpose fields (it is not personal-data autofill). No applicable input fields are present to annotate with `autocomplete`. |
| **1.4.3 Contrast (Minimum)** | Supports | Default theme tokens (`theme.ts`) meet or exceed 4.5:1 for normal text. Body text `--rag-fg` `#1a1a1a` on `--rag-bg` `#ffffff` is ~15:1; user-bubble `--rag-user-fg` `#ffffff` on `--rag-user-bg` `#1d4ed8` is ~6:1; muted text `--rag-muted` `#4b5563` on white is ~7:1; `--rag-danger` `#b91c1c` on white is ~6:1. **Caveat:** these ratios hold for the default theme only; an integrator-supplied `theme` prop can override the tokens and must be re-checked for contrast. |
| **1.4.4 Resize Text** | Supports | Sizing uses relative units (`rem`, `%`, `flex`) and `line-height` multipliers; message bubbles have no fixed-pixel heights. Text reflows to 200% zoom without loss of content or function. |
| **1.4.5 Images of Text** | Supports | No images of text are used; all text is live text. |
| **1.4.10 Reflow** | Supports | The container is fluid (`display: flex`, `flex: 1`, `overflow-y: auto`, `max-width: 85%` bubbles with `word-break: break-word`) and reflows to a single column without horizontal scrolling at narrow widths. Final conformance also depends on the host providing an appropriately sized container. |
| **1.4.11 Non-text Contrast** | Supports | Interactive boundaries and state indicators use tokens meeting 3:1 against adjacent colors: the input/citation borders use `--rag-border` `#d0d7de`, and focus indication relies on the preserved native focus outline (see 2.4.7). The accent `--rag-accent` `#1d4ed8` used for control affordances contrasts strongly against white/light backgrounds. |
| **1.4.12 Text Spacing** | Supports | No inline styles set fixed `line-height`/letter/word spacing in a way that clips content; bubbles use `line-height` multipliers and `white-space: pre-wrap` with `word-break: break-word`, so user-adjusted text spacing does not cause clipping or overlap. |
| **1.4.13 Content on Hover or Focus** | Not Applicable | The component shows no custom hover/focus-triggered overlays or tooltips. Citation detail is revealed by an explicit `<details>` toggle (a click/Enter activation), not by hover or focus. |
| **2.4.5 Multiple Ways** | Not Applicable | The component is a single conversational view, not a multi-page site; "multiple ways" to locate pages is a site-level concern owned by the host. |
| **2.4.6 Headings and Labels** | Supports | Headings and labels are descriptive: the citations region uses a "Sources" `<h3>`; each citation summary is self-describing ("Source 3: spec.pdf, page 12") rather than a bare "[N]"; the optional widget `title` renders as an `<h2>`; controls have descriptive accessible names. |
| **2.4.7 Focus Visible** | Supports | Default browser focus outlines are deliberately preserved on every interactive element — the code never sets `outline: none`. The `SourceCitations` summary explicitly retains the default focus outline, and `ChatInput` documents preserving the default outline for this criterion. |
| **2.5.5 Target Size (Enhanced)** | Not Applicable | Target Size (Enhanced) is a WCAG 2.1 **Level AAA** criterion and is outside the Level AA scope of this report. (See note under 2.5.8 below.) |
| **3.1.2 Language of Parts** | Not Applicable | The component does not author multilingual content or mark language changes; message content language is supplied by the host/data and any `lang` marking is the host's responsibility. |
| **3.2.3 Consistent Navigation** | Not Applicable | The component presents no repeated navigational mechanism across pages; consistency of site navigation is a host-level concern. |
| **3.2.4 Consistent Identification** | Supports | Components with the same function are identified consistently: every assistant message renders the same speaker label, citation, and feedback affordances with identical accessible names; the Send and feedback controls keep stable labels throughout the conversation. |
| **3.3.3 Error Suggestion** | Supports (within scope) | The composer's only validation is an empty-message guard handled by disabling Send (no error to correct/suggest). Substantive input-error suggestion for application flows is host-owned and out of component scope. |
| **3.3.4 Error Prevention (Legal, Financial, Data)** | Not Applicable | The chat UI submits conversational messages; it processes no legal, financial, or data-deletion transactions requiring reversal/confirmation safeguards. |
| **4.1.3 Status Messages** | Supports | Status changes are announced without moving focus. The transcript is `role="log"` with `aria-live="polite"` and `aria-relevant="additions text"` (`MessageList`); the typing indicator is `role="status"` with `aria-live="polite"` (`TypingIndicator`); and `StreamingText` uses a visually-hidden `aria-live="polite"` `aria-atomic` region that announces **sentence-buffered, newly-completed chunks** (with a debounce flush and an end-of-stream flush) rather than per-token updates — preventing the dozens-of-interruptions-per-second problem that raw token streaming would cause for screen-reader users. |

---

## Notes

- **Scope.** This VPAT covers the React chat UI components in `packages/ui-components/src/` (`ChatContainer`, `MessageList`, `Message`, `SourceCitations`, `TypingIndicator`, `ChatInput`, `FeedbackButtons`, `StreamingText`) and their default theme (`theme.ts`). The host application that embeds these components — page structure, `<title>`, document `lang`, authentication, navigation, and any application-level error/status surfaces rendered as system messages — must be evaluated separately by the integrator.

- **Default-theme dependency.** Color-contrast claims (1.4.3, 1.4.11) are based on the default `--rag-*` tokens. The `theme` prop allows agencies to override these tokens; any custom theme **must** be re-verified for contrast before it is considered conformant.

- **Methodology limitation.** The conformance levels above are derived from source-code and DOM-semantics inspection. They are **not** the result of an automated accessibility scan or live assistive-technology testing. Before relying on this VPAT for a procurement, conduct:
  - Automated testing with **axe-core** (recommended in CI with blocking thresholds), and
  - Manual screen-reader testing — **NVDA + Chrome** and **VoiceOver + Safari** (and ideally JAWS + Chrome) — exercising message announcement, streaming buffering, citation disclosure, feedback toggling, and keyboard-only operation.

- **Re-review trigger.** This document must be re-reviewed and updated **whenever the chat UI changes** — new components, markup/ARIA changes, theme-token changes, or interaction changes. Accessibility conformance degrades silently as the UI is patched; treat this VPAT as a living artifact tied to the component version in the header, not a one-time deliverable.

- **Standard caveat.** This VPAT is a self-disclosure prepared for procurement convenience. It is not a substitute for an independent third-party accessibility audit or for an agency's own Section 508 acceptance testing.
