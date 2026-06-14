/**
 * Bot entry point.
 *
 *   npm run dev --workspace=apps/bot -- --target=slack
 *   npm run dev --workspace=apps/bot -- --target=teams
 *
 * Target comes from `--target=` or the DEPLOYMENT_TARGET env (slack | teams | all),
 * defaulting to slack. Both bots share the same rag-core pipeline; only the chosen
 * one(s) construct their platform SDK, so you only need the tokens you actually use.
 */

import { startSlack } from "./slack";
import { startTeams } from "./teams";

type Target = "slack" | "teams" | "all";

function parseTarget(): Target {
  const flag = process.argv.find((a) => a.startsWith("--target="))?.split("=")[1];
  const value = (flag ?? process.env.DEPLOYMENT_TARGET ?? "slack").toLowerCase();
  return value === "teams" || value === "all" ? value : "slack";
}

const target = parseTarget();
const starting: Array<Promise<void>> = [];
if (target === "slack" || target === "all") starting.push(startSlack());
if (target === "teams" || target === "all") starting.push(startTeams());

await Promise.all(starting);
