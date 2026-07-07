import type { ExtractedFields, Posting, Profile, SourceConfig } from "./types.js";

/**
 * 適合度スコア 0-100。
 * エリア一致 / 専門キーワード一致 / 募集ステータス / LLM関連度 の合成。
 * 経験年数要件はスコアに影響させない（match_reasonに注意点として記載するのみ）。
 */
export function scorePosting(
  source: SourceConfig,
  profile: Profile,
  text: string,
  extracted: ExtractedFields | undefined,
  posting: Pick<Posting, "title" | "status" | "experience_requirement">,
): { score: number; reason: string } {
  const reasons: string[] = [];
  let score = 0;

  // 1) エリア (0-25)
  const areaText = `${source.area} ${text}`;
  const prefMatch = profile.areas.find((a) => a !== "全国" && areaText.includes(a));
  if (source.area === "全国" || /全国/.test(source.area)) {
    score += 20;
    reasons.push("全国対象");
  } else if (prefMatch) {
    score += 25;
    reasons.push(`エリア一致(${prefMatch})`);
    const cityMatch = profile.area_keywords.find((k) => areaText.includes(k));
    if (cityMatch) reasons.push(`近郊(${cityMatch})`);
  } else {
    reasons.push(`エリア対象外の可能性(${source.area})`);
  }

  // 2) 専門キーワード (0-40)
  const haystack = `${posting.title} ${text}`.slice(0, 20_000);
  const hits = profile.keywords
    .filter((k) => haystack.includes(k.word))
    .sort((a, b) => b.weight - a.weight);
  const kwScore = Math.min(40, hits.reduce((acc, k) => acc + k.weight * 1.6, 0));
  score += kwScore;
  if (hits.length) reasons.push(`専門一致: ${hits.slice(0, 5).map((h) => h.word).join(",")}`);

  // 3) ステータス (0-20)
  const statusScore: Record<string, number> = {
    募集中: 20,
    通年: 14,
    不明: 8,
    次回見込み: 4,
    締切: 0,
  };
  score += statusScore[posting.status] ?? 8;

  // 4) LLM関連度 (0-15 加点)
  if (extracted?.relevance !== undefined) {
    score += Math.round((extracted.relevance / 100) * 15);
    if (extracted.relevance <= 20) reasons.push("LLM判定: 専門家募集ではない可能性");
  }

  // 5) ネガティブキーワード（減点。除外はしない）
  const neg = (profile.negative_keywords ?? []).filter((w) => haystack.includes(w));
  if (neg.length) {
    score -= 15;
    reasons.push(`減点: ${neg.join(",")}`);
  }

  // 経験年数要件は注意点として表示のみ（スコア影響なし・除外なし）
  if (posting.experience_requirement) {
    reasons.push(`⚠年数要件あり(未充足の可能性・応募可否は要確認): ${posting.experience_requirement}`);
  }
  if (extracted?.relevance_reason) reasons.push(extracted.relevance_reason);

  return { score: Math.max(0, Math.min(100, Math.round(score))), reason: reasons.join(" / ") };
}

export function profileSummaryForLlm(profile: Profile): string {
  return [
    `資格: ${profile.qualifications.join(", ")}（診断士登録 ${profile.registered_at}）`,
    `専門: ${profile.specialties.join(", ")}`,
    `活動エリア: ${profile.areas.join(", ")}`,
  ].join("\n");
}
