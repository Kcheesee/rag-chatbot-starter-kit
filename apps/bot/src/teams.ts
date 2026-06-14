/**
 * Microsoft Teams adapter for the shared RAG bot.
 *
 * WHY a hand-rolled `node:http` server instead of restify/express: the Bot Framework
 * v4 `CloudAdapter` exposes `adapter.process(req, res, logic)` that consumes a raw
 * Node `IncomingMessage`/`ServerResponse` pair directly. There is exactly one inbound
 * route (`POST /api/messages`), so pulling in a web framework would add a dependency
 * and surface area for no benefit. `createServer` is enough.
 *
 * WHY credentials are read straight from `process.env` here (TEAMS_APP_ID /
 * TEAMS_APP_PASSWORD) rather than the validated rag-core env schema: these are the
 * Teams *platform* credentials this adapter owns. The core env schema deliberately
 * stays platform-agnostic so the same pipeline can power Slack, Teams, and the web UI
 * without each surface's secrets leaking into the shared config.
 *
 * WHY the modern auth stack (ConfigurationServiceClientCredentialFactory +
 * createBotFrameworkAuthenticationFromConfiguration + CloudAdapter): the legacy
 * `BotFrameworkAdapter` is deprecated in botbuilder v4.2x. The CloudAdapter path is
 * the supported way to authenticate against public and single-/multi-tenant clouds.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  ActivityHandler,
  CardFactory,
  CloudAdapter,
  ConfigurationServiceClientCredentialFactory,
  createBotFrameworkAuthenticationFromConfiguration,
  type Activity,
  type Attachment,
  type TurnContext,
} from "botbuilder";

import { answerQuestion, formatCitations } from "./respond";
import type { Citation } from "@rag-chat-agent/rag-core";

/** Default Bot Framework messaging port; Azure App Service injects PORT for hosted bots. */
const DEFAULT_PORT = 3978;

/** The single inbound webhook the Bot Framework channel posts activities to. */
const MESSAGES_PATH = "/api/messages";

/**
 * Build the Adaptive Card payload for an answer.
 *
 * WHY an Adaptive Card over plain text: Teams renders cards richly, letting us visually
 * separate the answer from its sources. We still set the activity's plain `text` (done by
 * the caller) so notifications and accessibility readers have a sensible fallback.
 *
 * The card object is an untyped JSON document by design — `CardFactory.adaptiveCard`
 * accepts the Adaptive Card schema as data, so we construct a plain object literal and
 * hand it over. No `any` is introduced: the literal is structurally typed and flows into
 * the factory's parameter.
 */
function buildAnswerCard(answer: string, citations: Citation[]): Attachment {
  const body: Array<Record<string, unknown>> = [
    {
      type: "TextBlock",
      text: answer,
      wrap: true,
    },
  ];

  if (citations.length > 0) {
    body.push({
      type: "TextBlock",
      text: "Sources",
      weight: "Bolder",
      spacing: "Medium",
      separator: true,
    });
    // FactSet keeps the citation index visually aligned with the source it points at.
    body.push({
      type: "FactSet",
      facts: citations.map((c) => ({
        title: `[${c.index}]`,
        value: `${c.sourceFile}${c.pageNumber !== undefined ? `, p.${c.pageNumber}` : ""}${
          c.heading !== undefined ? ` — ${c.heading}` : ""
        }`,
      })),
    });
  }

  return CardFactory.adaptiveCard({
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
  });
}

/**
 * Turn handler for the bot. Every inbound message is treated as a question.
 *
 * WHY `sessionId = conversation.id`: rag-core scopes its conversational memory window
 * per session, and a Teams conversation id is stable for the lifetime of a 1:1 chat,
 * group chat, or channel thread — so each conversation gets its own context window.
 */
class TeamsRagBot extends ActivityHandler {
  public constructor() {
    super();

    this.onMessage(async (context: TurnContext): Promise<void> => {
      const question = (context.activity.text ?? "").trim();
      const sessionId = context.activity.conversation.id;

      if (question.length === 0) {
        await context.sendActivity("Ask me a question and I'll search the knowledge base.");
        return;
      }

      // Show a typing indicator first so the user sees immediate feedback while the
      // (potentially slow) retrieval + generation runs.
      await context.sendActivities([{ type: "typing" }]);

      const { text, citations } = await answerQuestion(question, sessionId);

      // Rich Adaptive Card for Teams clients, with `text` as the accessible fallback
      // (used by notifications and channels that down-render the card).
      const reply: Partial<Activity> = {
        type: "message",
        text: `${text}${formatCitations(citations)}`,
        attachments: [buildAnswerCard(text, citations)],
      };
      await context.sendActivity(reply);
    });
  }
}

/**
 * Read a required Teams credential from the environment, throwing a clear, actionable
 * error if it is missing. We fail fast at startup rather than surfacing an opaque 401
 * from the Bot Framework once traffic arrives.
 */
function requireEnv(name: "TEAMS_APP_ID" | "TEAMS_APP_PASSWORD"): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Set TEAMS_APP_ID and TEAMS_APP_PASSWORD (the Azure Bot / Teams app registration credentials) before starting the Teams adapter.`,
    );
  }
  return value;
}

/**
 * Start the Teams adapter: wire up Bot Framework auth, the turn handler, and an HTTP
 * listener. Resolves once the server is accepting connections; rejects if the port
 * cannot be bound.
 */
export async function startTeams(): Promise<void> {
  const appId = requireEnv("TEAMS_APP_ID");
  const appPassword = requireEnv("TEAMS_APP_PASSWORD");

  const credentialsFactory = new ConfigurationServiceClientCredentialFactory({
    MicrosoftAppId: appId,
    MicrosoftAppPassword: appPassword,
  });

  // First argument is the optional Configuration source; we pass null because every
  // value the factory needs is already supplied above. This mirrors the canonical
  // botbuilder CloudAdapter setup.
  const botFrameworkAuthentication = createBotFrameworkAuthenticationFromConfiguration(
    null,
    credentialsFactory,
  );

  const adapter = new CloudAdapter(botFrameworkAuthentication);

  // Central error boundary: log, surface a generic apology to the user, and emit a
  // trace activity so failures are visible in the Bot Framework Emulator without
  // leaking internals to the chat surface.
  adapter.onTurnError = async (context: TurnContext, error: Error): Promise<void> => {
    console.error("[teams] unhandled error during turn:", error);
    await context.sendActivity("Sorry, something went wrong while answering that. Please try again.");
    await context.sendTraceActivity(
      "OnTurnError Trace",
      error.message,
      "https://www.botframework.com/schemas/error",
      "TurnError",
    );
  };

  const bot = new TeamsRagBot();

  const server = createServer((req: IncomingMessage, res: ServerResponse): void => {
    if (req.method === "POST" && req.url === MESSAGES_PATH) {
      // CloudAdapter.process is overloaded (web req/res vs streaming socket); cast it
      // to the web signature so TS resolves the right one. botbuilder accepts Node's
      // IncomingMessage/ServerResponse at runtime and owns writing the response.
      const runProcess = adapter.process.bind(adapter) as unknown as (
        request: IncomingMessage,
        response: ServerResponse,
        logic: (context: TurnContext) => Promise<void>,
      ) => Promise<void>;
      void runProcess(req, res, (context: TurnContext) => bot.run(context));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      console.log(`Teams bot listening on :${port}${MESSAGES_PATH}`);
      resolve();
    });
  });
}
