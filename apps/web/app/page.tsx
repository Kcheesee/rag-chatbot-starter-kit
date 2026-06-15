"use client";

import { useState, type ReactElement } from "react";

import { ChatContainer } from "@rag-chat-agent/ui-components";

import { useChat } from "./use-chat";

/**
 * The bundled demo knowledge bases, one per namespace (see `npm run seed`). Switching
 * the picker switches the `namespace` every request is scoped to — a live demo of the
 * kit's tenant isolation: the same pipeline answers only from the selected corpus.
 */
const KNOWLEDGE_BASES = [
  { namespace: "default", label: "Support desk", hint: "e.g. What is the refund window?" },
  { namespace: "bread", label: "Breadmaking", hint: "e.g. Why is my crumb dense?" },
  { namespace: "meds", label: "Medication reference", hint: "e.g. Generic name of Tylenol?" },
  { namespace: "pubsec", label: "Citizen services", hint: "e.g. How do I renew my passport?" },
] as const;

/**
 * The chat surface for one namespace. Pulled into its own component and given a
 * `key={namespace}` by the parent so switching the knowledge base remounts it with a
 * fresh conversation rather than carrying turns across corpora.
 */
function Chat({ namespace, label, hint }: { namespace: string; label: string; hint: string }): ReactElement {
  const { messages, busy, feedbackById, send, feedback } = useChat(namespace);
  return (
    <ChatContainer
      title={`RAG Chat Agent · ${label}`}
      messages={messages}
      onSend={send}
      busy={busy}
      onFeedback={feedback}
      feedbackById={feedbackById}
      placeholder={`Ask the ${label} knowledge base… (${hint})`}
    />
  );
}

export default function Page(): ReactElement {
  const [namespace, setNamespace] = useState<string>(KNOWLEDGE_BASES[0].namespace);
  const active = KNOWLEDGE_BASES.find((kb) => kb.namespace === namespace) ?? KNOWLEDGE_BASES[0];

  return (
    <main
      style={{
        height: "100dvh",
        maxWidth: 820,
        margin: "0 auto",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          borderBottom: "1px solid #d8dade",
        }}
      >
        <label htmlFor="kb-picker" style={{ fontSize: 14, fontWeight: 600, color: "#1a1a1a" }}>
          Knowledge base:
        </label>
        <select
          id="kb-picker"
          value={namespace}
          onChange={(e) => setNamespace(e.target.value)}
          style={{ fontSize: 14, padding: "4px 8px", borderRadius: 6, border: "1px solid #767b85" }}
        >
          {KNOWLEDGE_BASES.map((kb) => (
            <option key={kb.namespace} value={kb.namespace}>
              {kb.label}
            </option>
          ))}
        </select>
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Chat key={namespace} namespace={namespace} label={active.label} hint={active.hint} />
      </div>
    </main>
  );
}
