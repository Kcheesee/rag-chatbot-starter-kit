/**
 * @rag-chat-agent/ui-components — public surface.
 *
 * WCAG 2.1 AA-compliant React chat components, themeable via CSS custom properties.
 * `ChatContainer` is the composed root; the rest are exported for hosts that want to
 * assemble their own layout. The components are a leaf package (no internal deps) —
 * hosts map their pipeline response onto the view types here.
 */

export { ChatContainer, type ChatContainerProps } from "./ChatContainer";
export { MessageList, type MessageListProps } from "./MessageList";
export { Message, type MessageProps } from "./Message";
export { ChatInput, type ChatInputProps } from "./ChatInput";
export { StreamingText, type StreamingTextProps } from "./StreamingText";
export { SourceCitations, type SourceCitationsProps } from "./SourceCitations";
export { TypingIndicator, type TypingIndicatorProps } from "./TypingIndicator";
export { FeedbackButtons, type FeedbackButtonsProps } from "./FeedbackButtons";

export { DEFAULT_THEME_VARS, themeStyle, srOnly } from "./theme";
export type { MessageRole, FeedbackValue, CitationView, MessageView, Theme } from "./types";
