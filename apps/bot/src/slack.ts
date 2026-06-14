/**
 * Slack adapter (Socket Mode) for the shared RAG bot.
 *
 * WHY Socket Mode: it lets the bot run behind a firewall with no public HTTPS
 * endpoint — Bolt opens an outbound WebSocket to Slack using an app-level token
 * (xapp-…). That is the right fit for an internal knowledge bot that may run on a
 * laptop or a locked-down host, so we never expose an inbound request URL.
 *
 * WHY this app reads tokens directly from process.env: the Slack/Teams platform
 * credentials are deployment-surface specific and deliberately kept OUT of the
 * core env schema (loadEnv) so the RAG core stays platform-agnostic. Each adapter
 * owns its own platform tokens.
 *
 * All answering logic lives in ./respond — this file is purely the Slack I/O
 * boundary: receive a question, derive a per-thread session, render the answer
 * plus citations as Block Kit, and reply in-thread.
 */

import { App, type KnownEventFromType, types } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { answerQuestion } from "./respond";
import type { Citation } from "@rag-chat-agent/rag-core";

/**
 * Bolt v4 moved the Block Kit types under the namespaced `types` export
 * (`export * as types from "@slack/types"`), so we alias the two block shapes we
 * emit here rather than importing them as bare names (which no longer resolve).
 */
type SectionBlock = types.SectionBlock;
type ContextBlock = types.ContextBlock;
/** A reply is a section block (the answer) optionally followed by a context block (citations). */
type ReplyBlock = SectionBlock | ContextBlock;

/**
 * The DM/message event shape. Bolt models `message` as a discriminated union over
 * `subtype`; the plain user-message member carries the fields we need. We narrow to
 * it at runtime (see {@link isHandleableDirectMessage}) before reading these.
 */
type MessageEvent = KnownEventFromType<"message">;

/**
 * Names of the platform credentials this adapter requires. Kept as a const tuple so
 * the missing-config check below can list every absent variable in one clear error.
 */
const REQUIRED_ENV = ["SLACK_BOT_TOKEN", "SLACK_APP_TOKEN", "SLACK_SIGNING_SECRET"] as const;

/**
 * Read and validate the Slack platform tokens from the environment.
 *
 * WHY fail fast and list ALL missing vars: a half-configured Socket Mode app fails
 * with opaque WebSocket errors at connect time. Surfacing every missing variable up
 * front — before the App is constructed — turns that into a single actionable message.
 *
 * @throws if any of {@link REQUIRED_ENV} is unset or empty.
 */
function readSlackConfig(): { botToken: string; appToken: string; signingSecret: string } {
  const missing = REQUIRED_ENV.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === "";
  });
  if (missing.length > 0) {
    throw new Error(
      `Slack adapter is missing required environment variable(s): ${missing.join(", ")}. ` +
        `These are platform tokens read directly by the bot, not part of the core env schema. ` +
        `See CONFIG.md#auth.`,
    );
  }
  // Non-null assertions are safe: every name passed the emptiness check above.
  return {
    botToken: process.env.SLACK_BOT_TOKEN!,
    appToken: process.env.SLACK_APP_TOKEN!,
    signingSecret: process.env.SLACK_SIGNING_SECRET!,
  };
}

/**
 * Render one citation as a compact Block Kit context line: `[1] file.pdf, p.3`.
 * Page number is omitted when the source is not paginated.
 */
function renderCitation(citation: Citation): string {
  const page = citation.pageNumber !== undefined ? `, p.${citation.pageNumber}` : "";
  return `[${citation.index}] ${citation.sourceFile}${page}`;
}

/**
 * Build the Block Kit blocks for a reply: a section with the mrkdwn answer, then —
 * when present — a context block listing the citations, and an escalation note when
 * the pipeline could not find a confident answer (a signal to loop in a human).
 */
function buildReplyBlocks(answer: { text: string; citations: Citation[]; escalated: boolean }): ReplyBlock[] {
  const blocks: ReplyBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: answer.text },
    },
  ];

  if (answer.citations.length > 0) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: answer.citations.map(renderCitation).join("  ·  "),
        },
      ],
    });
  }

  if (answer.escalated) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: ":warning: I couldn't find a confident answer in the knowledge base — a human may need to follow up.",
        },
      ],
    });
  }

  return blocks;
}

/**
 * Shared response path for both triggers: post a brief working signal, run the RAG
 * pipeline, then post the rendered answer in-thread.
 *
 * WHY a plain "…thinking" message instead of a typing indicator: Bolt has no
 * `chat.typing` for Events API listeners, and the proper Assistant status API only
 * applies to assistant threads. A short throwaway post is the simplest reliable way
 * to show the bot is working; we keep it minimal and always reply in the thread.
 *
 * @param client  the per-event Web API client (already scoped to the bot token).
 * @param channel the channel the event arrived on.
 * @param threadTs the thread to reply in (also doubles as the conversation session key).
 * @param question the user's question with any bot mention already stripped.
 */
async function respondInThread(
  client: WebClient,
  channel: string,
  threadTs: string,
  question: string,
): Promise<void> {
  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: ":hourglass_flowing_sand: …thinking",
  });

  // The thread timestamp is the per-thread conversation window: replies in the same
  // thread share short-term memory; a new top-level message starts a fresh session.
  const answer = await answerQuestion(question, threadTs);
  const blocks = buildReplyBlocks(answer);

  await client.chat.postMessage({
    channel,
    thread_ts: threadTs,
    // `text` is the required notification/fallback string for clients that can't
    // render blocks (also used for accessibility and push previews).
    text: answer.text,
    blocks,
  });
}

/**
 * Strip a single leading `<@BOTID>` mention from an app_mention's text so the RAG
 * pipeline receives just the question. Only the leading mention is removed; mentions
 * elsewhere in the sentence are left intact.
 */
function stripLeadingMention(text: string): string {
  return text.replace(/^\s*<@[A-Z0-9]+>\s*/i, "").trim();
}

/**
 * Type guard: should this `message` event be handled as a direct-message question?
 *
 * We only answer plain user messages in IM channels. This excludes:
 *  - non-IM channels (handled instead via @-mentions),
 *  - subtyped events (edits, deletes, joins, bot posts, file shares, …),
 *  - the bot's own and other bots' messages (`bot_id`), which would otherwise loop.
 *
 * Narrowing here lets us safely read `text`/`ts`/`channel`/`thread_ts` afterward
 * without `any`, since the union member without a subtype carries those fields.
 */
function isHandleableDirectMessage(
  event: MessageEvent,
): event is types.GenericMessageEvent {
  return (
    event.channel_type === "im" &&
    !("subtype" in event && event.subtype !== undefined) &&
    !("bot_id" in event && event.bot_id !== undefined)
  );
}

/**
 * Construct, wire up, and start the Slack bot in Socket Mode.
 *
 * Registers two triggers:
 *  - `app_mention` in any channel the bot is in, and
 *  - direct messages (IM channels) sent straight to the bot.
 *
 * Resolves once the WebSocket connection is established. Errors inside listeners are
 * caught and logged via Bolt's logger so a single failed question never tears down
 * the connection.
 *
 * @throws if required Slack tokens are missing (see {@link readSlackConfig}).
 */
export async function startSlack(): Promise<void> {
  const { botToken, appToken, signingSecret } = readSlackConfig();

  const app = new App({
    token: botToken,
    appToken,
    signingSecret,
    socketMode: true,
  });

  // @-mention in a channel: strip the leading mention, then answer in the thread.
  app.event("app_mention", async ({ event, client, logger }) => {
    try {
      // Bolt types `event` as the app_mention payload for this listener.
      const question = stripLeadingMention(event.text ?? "");
      if (question === "") return; // bare mention with no question — nothing to answer.

      // Reply in the existing thread when mentioned in one; otherwise root the thread
      // on this message so the answer (and follow-ups) stay grouped.
      const threadTs = event.thread_ts ?? event.ts;
      await respondInThread(client, event.channel, threadTs, question);
    } catch (error) {
      logger.error("Failed to handle app_mention", error);
    }
  });

  // Direct message to the bot: only plain user IM messages are handled.
  app.message(async ({ message, client, logger }) => {
    try {
      if (!isHandleableDirectMessage(message)) return;

      const question = (message.text ?? "").trim();
      if (question === "") return;

      const threadTs = message.thread_ts ?? message.ts;
      await respondInThread(client, message.channel, threadTs, question);
    } catch (error) {
      logger.error("Failed to handle direct message", error);
    }
  });

  await app.start();
  app.logger.info("Slack bot is running (socket mode)");
}
