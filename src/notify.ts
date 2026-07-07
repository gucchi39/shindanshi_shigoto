import { mkdirSync, writeFileSync } from "node:fs";
import { env } from "./config.js";
import type { CrawlFailure, Posting } from "./types.js";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function todayJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysUntil(deadline: string): number {
  const today = new Date(`${todayJst()}T00:00:00Z`).getTime();
  const d = new Date(`${deadline}T00:00:00Z`).getTime();
  return Math.round((d - today) / 86_400_000);
}

/** 締切N日前リマインド対象（14日前・3日前 ± 当日） */
export function deadlineReminders(postings: Posting[]): { posting: Posting; days: number }[] {
  return postings
    .filter((p) => p.deadline && p.status !== "締切")
    .map((p) => ({ posting: p, days: daysUntil(p.deadline!) }))
    .filter(({ days }) => days === 14 || days === 3 || days === 0)
    .sort((a, b) => a.days - b.days);
}

function postingLine(p: Posting): string {
  const deadline = p.deadline ? `締切 ${p.deadline}` : p.status;
  return `*<${p.url}|${escapeSlack(p.title)}>*\n${escapeSlack(p.org)}｜${p.area}｜${deadline}｜スコア *${p.match_score}*\n${escapeSlack(truncate(p.match_reason, 180))}`;
}

function escapeSlack(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

export async function notifySlack(
  newPostings: Posting[],
  reminders: { posting: Posting; days: number }[],
  failures: CrawlFailure[],
): Promise<void> {
  if (!env.slackWebhookUrl) {
    console.log("SLACK_WEBHOOK_URL 未設定のためSlack通知をスキップ");
    return;
  }
  if (!newPostings.length && !reminders.length && !failures.length) return;

  const blocks: unknown[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `📋 公的機関 案件チェック ${todayJst()}` },
    },
  ];

  if (newPostings.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*🆕 新着 ${newPostings.length}件*（スコア順）` },
    });
    for (const p of newPostings.slice(0, 15)) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: postingLine(p) } });
    }
    if (newPostings.length > 15) {
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `…ほか ${newPostings.length - 15} 件は data/report.md 参照` },
      });
    }
  }

  if (reminders.length) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: "*⏰ 締切リマインド*" } });
    for (const { posting, days } of reminders.slice(0, 10)) {
      const label = days === 0 ? "本日締切!" : `あと${days}日`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `[${label}] ${postingLine(posting)}` },
      });
    }
  }

  if (failures.length) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `*⚠️ 取得失敗 ${failures.length}件*（サイト構造変更の可能性）\n` +
          failures.slice(0, 10).map((f) => `• ${f.source_id}: ${truncate(f.error, 100)}`).join("\n"),
      },
    });
  }

  const res = await fetch(env.slackWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ blocks }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Slack notify failed: HTTP ${res.status} ${await res.text()}`);
  console.log(`Slack通知送信: 新着${newPostings.length} リマインド${reminders.length} 失敗${failures.length}`);
}

/** 常にMarkdownレポートも生成（Slack未設定でも確認できるように） */
export function writeReport(
  allPostings: Posting[],
  newPostings: Posting[],
  reminders: { posting: Posting; days: number }[],
  failures: CrawlFailure[],
): void {
  const active = allPostings.filter((p) => p.status !== "締切");
  const lines: string[] = [
    `# 公的機関 案件レポート (${todayJst()})`,
    "",
    `- 収集済み: ${allPostings.length}件（うち募集中・通年など ${active.length}件）`,
    `- 今回の新着: ${newPostings.length}件 / 取得失敗: ${failures.length}件`,
    "",
  ];

  if (reminders.length) {
    lines.push("## ⏰ 締切間近", "");
    for (const { posting, days } of reminders) {
      lines.push(`- **${days === 0 ? "本日締切" : `あと${days}日`}** [${posting.title}](${posting.url})（${posting.org} / 締切 ${posting.deadline}）`);
    }
    lines.push("");
  }

  if (newPostings.length) {
    lines.push("## 🆕 新着", "");
    pushTable(lines, newPostings);
  }

  lines.push("## 📋 全案件（スコア順・締切済み除く）", "");
  pushTable(lines, active.sort((a, b) => b.match_score - a.match_score));

  if (failures.length) {
    lines.push("## ⚠️ 取得失敗", "");
    for (const f of failures) lines.push(`- ${f.source_id}: ${f.error}`);
    lines.push("");
  }

  mkdirSync("data", { recursive: true });
  writeFileSync("data/report.md", lines.join("\n") + "\n");
}

function pushTable(lines: string[], postings: Posting[]): void {
  lines.push("| スコア | 案件 | 機関 | エリア | 締切/状態 | 要件・注意 |");
  lines.push("|---|---|---|---|---|---|");
  for (const p of postings) {
    const deadline = p.deadline ?? p.status;
    const note = (p.experience_requirement ? `⚠${p.experience_requirement} / ` : "") + (p.requirements ?? "");
    lines.push(
      `| ${p.match_score} | [${cell(p.title)}](${p.url}) | ${cell(p.org)} | ${cell(p.area)} | ${cell(deadline)} | ${cell(note.slice(0, 120))} |`,
    );
  }
  lines.push("");
}

function cell(s: string): string {
  return s.replace(/\|/g, "／").replace(/\n/g, " ");
}
