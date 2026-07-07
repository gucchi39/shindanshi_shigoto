import { env, loadProfile, loadSources } from "./config.js";
import { fetchPage } from "./fetch.js";
import {
  detectExperienceRequirement,
  extractCandidateLinks,
  extractDeadline,
  guessStatus,
  hashContent,
  itemId,
  llmExtract,
} from "./extract.js";
import { deadlineReminders, notifySlack, writeReport } from "./notify.js";
import { profileSummaryForLlm, scorePosting } from "./score.js";
import { loadPostings, loadSeen, savePostings, saveSeen, upsertPostings } from "./store.js";
import type { CrawlFailure, Posting, SourceConfig } from "./types.js";

/**
 * パイプライン: 巡回 → 差分検知 → 抽出(新着のみLLM) → スコアリング → 保存 → 通知
 *
 * 実行例:
 *   npm run crawl                       # 全ソース巡回
 *   tsx src/main.ts --source=smrj-procurement  # 1ソースのみ
 *   DRY_RUN=1 npm run crawl             # 通知・保存なし
 */
async function main(): Promise<void> {
  const sourceFilter = process.argv.find((a) => a.startsWith("--source="))?.split("=")[1];
  const sources = loadSources().filter((s) => !sourceFilter || s.id === sourceFilter);
  const profile = loadProfile();
  const profileSummary = profileSummaryForLlm(profile);

  const seen = loadSeen();
  const existingPostings = loadPostings();
  const failures: CrawlFailure[] = [];
  const newPostings: Posting[] = [];
  const updatedPostings: Posting[] = [];
  const now = new Date().toISOString();
  let llmCalls = 0;

  console.log(`巡回開始: ${sources.length}ソース (LLM: ${env.anthropicApiKey ? env.claudeModel : "無効"})`);

  for (const source of sources) {
    try {
      const page = await fetchPage(source.url);
      const pageHash = hashContent(page.text);
      const prevHash = seen.pages[source.id]?.hash;
      const pageChanged = pageHash !== prevHash;
      seen.pages[source.id] = { hash: pageHash, last_fetched: now };

      if (source.watch_only) {
        if (pageChanged && prevHash) {
          console.log(`[${source.id}] ページ更新を検知（watch_only）`);
          newPostings.push(makeWatchPosting(source, page.text, profile, now, profileSummary));
        }
        continue;
      }

      if (page.contentType === "pdf") {
        // ソースURL自体がPDFの場合は1件の案件として扱う
        await processCandidate(source, { url: page.finalUrl, title: source.name }, page.text, "pdf");
        continue;
      }

      const candidates = extractCandidateLinks(page.body, page.finalUrl, source);
      console.log(`[${source.id}] 候補リンク ${candidates.length}件 (ページ変化: ${pageChanged})`);

      for (const cand of candidates) {
        const id = itemId(cand.url);
        if (seen.items[id]) continue; // 既知
        seen.items[id] = { url: cand.url, first_seen: now, source_id: source.id };

        // 初回実行（prevHashなし）は通知の洪水を避けるため、詳細取得はするが新着扱いは維持
        let detailText = "";
        let sourceType: Posting["source_type"] = "listing";
        try {
          const detail = await fetchPage(cand.url);
          detailText = detail.text;
          sourceType = detail.contentType === "pdf" ? "pdf" : "detail";
        } catch (e) {
          console.warn(`[${source.id}] 詳細取得失敗 ${cand.url}: ${String(e)}`);
        }
        await processCandidate(source, cand, detailText, sourceType);
      }
    } catch (e) {
      const msg = String(e instanceof Error ? e.message : e);
      console.error(`[${source.id}] 失敗: ${msg}`);
      failures.push({ source_id: source.id, url: source.url, error: msg });
    }
  }

  async function processCandidate(
    source: SourceConfig,
    cand: { url: string; title: string },
    detailText: string,
    sourceType: Posting["source_type"],
  ): Promise<void> {
    const text = detailText || cand.title;
    const useLlm = Boolean(env.anthropicApiKey) && detailText.length > 100 && llmCalls < env.maxLlmCalls;
    const extracted = useLlm ? (llmCalls++, await llmExtract(text, cand.url, profileSummary)) : undefined;

    const experienceReq = extracted?.requirements
      ? detectExperienceRequirement(extracted.requirements) ?? detectExperienceRequirement(text)
      : detectExperienceRequirement(text);

    const base = {
      title: extracted?.title || cand.title,
      status: extracted?.status ?? guessStatus(text),
      experience_requirement: experienceReq,
    };
    const { score, reason } = scorePosting(source, profile, text, extracted, base);

    const posting: Posting = {
      id: itemId(cand.url),
      title: base.title,
      org: extracted?.org || source.name,
      source_id: source.id,
      category: source.category,
      area: source.area,
      period_start: extracted?.period_start ?? undefined,
      deadline: extracted?.deadline ?? extractDeadline(text),
      status: base.status,
      requirements: extracted?.requirements ?? undefined,
      experience_requirement: experienceReq,
      reward: extracted?.reward ?? undefined,
      how_to_apply: extracted?.how_to_apply ?? undefined,
      url: cand.url,
      source_type: sourceType,
      fetched_at: now,
      first_seen: now,
      match_score: score,
      match_reason: reason,
      summary: extracted?.summary ?? undefined,
      llm_processed: Boolean(extracted),
    };
    newPostings.push(posting);
    updatedPostings.push(posting);
  }

  // 保存・通知
  const merged = upsertPostings(existingPostings, updatedPostings);
  const reminders = deadlineReminders(merged);
  newPostings.sort((a, b) => b.match_score - a.match_score);

  if (env.dryRun) {
    console.log(`\n[DRY RUN] 新着 ${newPostings.length}件 / リマインド ${reminders.length}件 / 失敗 ${failures.length}件`);
    for (const p of newPostings.slice(0, 30)) {
      console.log(`  ${String(p.match_score).padStart(3)} | ${p.title} | ${p.org} | ${p.deadline ?? p.status}`);
    }
    return;
  }

  savePostings(merged);
  saveSeen(seen);
  writeReport(merged, newPostings, reminders, failures);

  try {
    await notifySlack(newPostings, reminders, failures);
  } catch (e) {
    console.error(`Slack通知失敗: ${String(e)}`);
  }

  console.log(
    `完了: 新着${newPostings.length} 全${merged.length}件 リマインド${reminders.length} 失敗${failures.length} LLM${llmCalls}回`,
  );
  if (failures.length === sources.length && sources.length > 0) {
    process.exitCode = 1; // 全滅は異常（黙って0件にならないように）
  }
}

function makeWatchPosting(
  source: SourceConfig,
  text: string,
  profile: ReturnType<typeof loadProfile>,
  now: string,
  _profileSummary: string,
): Posting {
  const base = { title: `${source.name} が更新されました`, status: guessStatus(text), experience_requirement: undefined };
  const { score, reason } = scorePosting(source, profile, text, undefined, base);
  return {
    id: itemId(`${source.url}#${now.slice(0, 10)}`),
    title: base.title,
    org: source.name,
    source_id: source.id,
    category: source.category,
    area: source.area,
    status: base.status,
    url: source.url,
    source_type: "listing",
    fetched_at: now,
    first_seen: now,
    match_score: score,
    match_reason: `ページ更新検知 / ${reason}`,
    llm_processed: false,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
