import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// jsdom doesn't implement scrollIntoView; MessageList calls it to autoscroll.
beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

import {
  ChatContainer,
  ChatInput,
  FeedbackButtons,
  Message,
  MessageList,
  SourceCitations,
  StreamingText,
  TypingIndicator,
} from "../index";
import type { MessageView } from "../index";

afterEach(cleanup);

describe("ChatInput", () => {
  it("submits a trimmed message on Enter and clears", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);
    const box = screen.getByLabelText("Message");
    await user.type(box, "  hello world  ");
    await user.type(box, "{Enter}");
    expect(onSend).toHaveBeenCalledWith("hello world");
    expect(box).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter without submitting", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatInput onSend={onSend} />);
    const box = screen.getByLabelText("Message");
    await user.type(box, "line1{Shift>}{Enter}{/Shift}line2");
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("line1\nline2");
  });

  it("exposes an accessible send button", () => {
    render(<ChatInput onSend={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });
});

describe("FeedbackButtons", () => {
  it("is a labelled group of two buttons and reports clicks", async () => {
    const onFeedback = vi.fn();
    const user = userEvent.setup();
    render(<FeedbackButtons value={null} onFeedback={onFeedback} />);
    expect(screen.getByRole("group", { name: /helpful/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Helpful" }));
    expect(onFeedback).toHaveBeenCalledWith("up");
  });

  it("reflects the current selection with aria-pressed (not colour alone)", () => {
    render(<FeedbackButtons value="up" onFeedback={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Helpful" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Not helpful" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});

describe("SourceCitations", () => {
  it("renders descriptive, expandable source summaries", () => {
    render(
      <SourceCitations
        citations={[{ index: 1, sourceFile: "returns.md", pageNumber: 2, heading: "Returns" }]}
      />,
    );
    // Descriptive summary — not a bare "[1]".
    expect(screen.getByText(/Source 1:.*returns\.md.*page 2/i)).toBeInTheDocument();
  });

  it("renders nothing when there are no citations", () => {
    const { container } = render(<SourceCitations citations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TypingIndicator", () => {
  it("is a status region with an accessible label", () => {
    render(<TypingIndicator />);
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(screen.getByText("Assistant is typing…")).toBeInTheDocument();
  });
});

describe("StreamingText", () => {
  it("shows the visible text and exposes a polite live region", () => {
    const { container } = render(<StreamingText text="Refunds take 30 days." streaming={false} />);
    // The text appears in the visible span and (once flushed) the sr-only live
    // region, so there can be more than one match — assert at least one.
    expect(screen.getAllByText("Refunds take 30 days.").length).toBeGreaterThan(0);
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull();
  });
});

describe("Message", () => {
  const assistant: MessageView = { id: "a1", role: "assistant", content: "Answer [1]." };
  const user: MessageView = { id: "u1", role: "user", content: "Question?" };

  it("shows feedback controls on assistant messages when onFeedback is given", () => {
    render(<Message message={assistant} onFeedback={vi.fn()} />);
    expect(screen.getByRole("group", { name: /helpful/i })).toBeInTheDocument();
  });

  it("does not show feedback controls on user messages", () => {
    render(<Message message={user} onFeedback={vi.fn()} />);
    expect(screen.queryByRole("group", { name: /helpful/i })).toBeNull();
    expect(screen.getByText("Question?")).toBeInTheDocument();
  });
});

describe("MessageList", () => {
  it("is an aria-live log of messages", () => {
    const messages: MessageView[] = [
      { id: "u1", role: "user", content: "Hi" },
      { id: "a1", role: "assistant", content: "Hello [1]." },
    ];
    render(<MessageList messages={messages} />);
    const log = screen.getByRole("log");
    expect(log).toHaveAttribute("aria-live", "polite");
  });
});

describe("ChatContainer", () => {
  it("renders the title, transcript, composer, and applies the theme", () => {
    const { container } = render(
      <ChatContainer
        title="Acme Support"
        messages={[{ id: "u1", role: "user", content: "Hi" }]}
        onSend={vi.fn()}
        theme={{ "--rag-accent": "#ff0000" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Acme Support" })).toBeInTheDocument();
    expect(screen.getByLabelText("Message")).toBeInTheDocument();
    const root = container.firstChild as HTMLElement;
    expect(root.style.getPropertyValue("--rag-accent")).toBe("#ff0000");
  });
});
