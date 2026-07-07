import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type { Profile, SourceConfig } from "./types.js";

export function loadSources(path = "config/sources.yaml"): SourceConfig[] {
  const raw = parse(readFileSync(path, "utf-8")) as { sources: SourceConfig[] };
  return (raw.sources ?? []).filter((s) => !s.disabled);
}

export function loadProfile(path = "config/profile.yaml"): Profile {
  return parse(readFileSync(path, "utf-8")) as Profile;
}

export const env = {
  slackWebhookUrl: process.env.SLACK_WEBHOOK_URL,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  claudeModel: process.env.CLAUDE_MODEL || "claude-opus-4-8",
  /** 1回の巡回でLLM抽出にかける新着数の上限（コスト対策） */
  maxLlmCalls: Number(process.env.MAX_LLM_CALLS || 25),
  dryRun: process.env.DRY_RUN === "1",
};
