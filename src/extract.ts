import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "./config.js";
import type { ExtractedFields, PostingStatus, SourceConfig } from "./types.js";

/** リンク抽出のデフォルトキーワード（アンカーテキスト or URL に含まれれば候補） */
const LINK_KEYWORDS = [
  "募集",
  "公募",
  "専門家",
  "アドバイザー",
  "コーディネーター",
  "エキスパート",
  "登録",
  "委嘱",
  "派遣",
  "メンター",
  "相談員",
  "サポーター",
  "審査",
  "調達",
];

const DEFAULT_EXCLUDE = [
  "javascript:",
  "mailto:",
  "tel:",
  "#",
  "facebook.com",
  "twitter.com",
  "x.com/",
  "instagram.com",
  "youtube.com",
  "line.me",
];

/**
 * タイトルがこれらに一致するリンクは除外する。
 * 診断士が専門家として応募する募集ではない「事業者向けイベント・物品調達・お祭り」等の定型ノイズ。
 * ※「専門家/アドバイザー/委嘱/サポーター募集」等は一致しないように、必ず"事業者向け"を示す語で限定する。
 */
const NOISE_TITLE_PATTERNS: RegExp[] = [
  /(出展|出店)(企業|者)?募集/,
  /来場(者)?(事前)?(登録|受付)/,
  /(参加者|参加企業|参加事業者|受講者|受講生|応募者)を?募集/,
  /(商談会|展示会|見本市|ミニ展|物産展|即売|マルシェ|物販|フェア|まつり|大商業祭|商業祭|お稚児)/,
  /商品券/,
  /簿記/,
  /(意見招請|仕様書|物品等?の?調達|端末|労働者派遣業務)/,
  /創業塾/,
  /セミナー(等|の参加|参加者|受講|一覧|募集情報)/,
  /講座.{0,12}(開催|受講|参加|募集)/,
  /参加募集/,
  /(メルマガ|メールマガジン|配信登録|登録はこちら)/,
  // スタッフ紹介・コラム系（「専門家募集一覧」は残すため"専門家"は紹介のみ対象）
  /(コーディネーター|サポーター|相談員|アドバイザー|専門家|コンサルタント)紹介/,
  /(コーディネーター|サポーター|相談員|アドバイザー)(一覧|ブログ)/,
];

function isNoiseTitle(title: string, source: SourceConfig): boolean {
  if (NOISE_TITLE_PATTERNS.some((re) => re.test(title))) return true;
  if (source.title_exclude?.some((w) => title.includes(w))) return true;
  return false;
}

export function hashContent(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

export function itemId(url: string): string {
  return createHash("sha256").update(normalizeUrl(url)).digest("hex").slice(0, 12);
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "fbclid"]) {
      u.searchParams.delete(p);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export interface CandidateLink {
  url: string;
  title: string;
}

/** 一覧ページから募集らしきリンクを抽出する */
export function extractCandidateLinks(html: string, baseUrl: string, source: SourceConfig): CandidateLink[] {
  const $ = cheerio.load(html);
  const keywords = [...LINK_KEYWORDS, ...(source.link_keywords ?? [])];
  const excludes = [...DEFAULT_EXCLUDE, ...(source.link_exclude ?? [])];
  const seen = new Set<string>();
  const results: CandidateLink[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")!.trim();
    if (!href || excludes.some((x) => href.includes(x))) return;

    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!abs.startsWith("http")) return;

    const text = $(el).text().replace(/\s+/g, " ").trim() || $(el).attr("title")?.trim() || "";
    const isPdf = new URL(abs).pathname.toLowerCase().endsWith(".pdf");
    const haystack = `${text} ${abs}`;
    if (!keywords.some((k) => haystack.includes(k))) return;
    // テキストが短すぎるリンク（アイコン等）はPDF以外除外
    if (text.length < 4 && !isPdf) return;
    // 事業者向けイベント等の定型ノイズを除外（PDFの募集要項は落とさない）
    if (!isPdf && isNoiseTitle(text, source)) return;

    const norm = normalizeUrl(abs);
    if (seen.has(norm) || norm === normalizeUrl(baseUrl)) return;
    seen.add(norm);
    results.push({ url: norm, title: text || norm });
  });

  return results;
}

// ---- 日付抽出（ルールベース） ----

const REIWA_BASE = 2018;

export function parseJapaneseDate(s: string): string | undefined {
  let m = s.match(/令和\s*(\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return fmt(REIWA_BASE + Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (m) return fmt(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/(20\d{2})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  if (m) return fmt(Number(m[1]), Number(m[2]), Number(m[3]));
  return undefined;
}

function fmt(y: number, mo: number, d: number): string | undefined {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 本文から締切日をルールベースで推定 */
export function extractDeadline(text: string): string | undefined {
  const patterns = [
    /(?:締切|締め切り|〆切|応募期限|申込期限|提出期限|受付期限)[^\n。]{0,40}/g,
    /(?:まで|必着)[^\n。]{0,10}/g,
  ];
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const around = text.slice(Math.max(0, m.index! - 60), m.index! + m[0].length + 20);
      const d = parseJapaneseDate(around);
      if (d) return d;
    }
  }
  return undefined;
}

/** 経験年数要件の検出（記録のみ。除外には使わない） */
export function detectExperienceRequirement(text: string): string | undefined {
  const patterns = [
    /(?:登録|取得|資格)[^\n。]{0,15}(\d{1,2})\s*年以上/g,
    /実務経験[^\n。]{0,15}(\d{1,2})\s*年以上/g,
    /(\d{1,2})\s*年以上の(?:実務|経験|支援|コンサル)/g,
  ];
  const hits = new Set<string>();
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      // マッチ箇所を含む文全体（。区切り）を切り出す
      const start = text.lastIndexOf("。", m.index!) + 1;
      const endIdx = text.indexOf("。", m.index! + m[0].length);
      const sentence = text
        .slice(start, endIdx === -1 ? m.index! + m[0].length + 40 : endIdx + 1)
        .replace(/\s+/g, " ")
        .trim();
      if (sentence) hits.add(sentence.slice(0, 160));
    }
  }
  return hits.size ? [...hits].slice(0, 2).join(" / ") : undefined;
}

export function guessStatus(text: string): PostingStatus {
  if (/(募集は終了|受付は終了|締め?切りました|終了しました)/.test(text)) return "締切";
  if (/(通年|随時)(募集|受付|登録)/.test(text)) return "通年";
  if (/(募集中|受付中|募集して|公募中)/.test(text)) return "募集中";
  return "不明";
}

// ---- LLM抽出（任意・APIキーがある場合のみ） ----

const EXTRACT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "制度名・事業名（募集タイトル）" },
    org: { type: "string", description: "運営機関名" },
    period_start: { type: ["string", "null"], description: "募集開始日 YYYY-MM-DD（不明ならnull）" },
    deadline: { type: ["string", "null"], description: "応募締切日 YYYY-MM-DD（不明・通年ならnull）" },
    status: { type: "string", enum: ["募集中", "締切", "通年", "次回見込み", "不明"] },
    requirements: {
      type: ["string", "null"],
      description: "応募要件。資格要件・経験年数要件を省略せずそのまま記録する",
    },
    reward: { type: ["string", "null"], description: "報酬・謝金（日額/時間単価/1回あたり等）" },
    how_to_apply: { type: ["string", "null"], description: "応募方法の要約" },
    summary: { type: ["string", "null"], description: "募集内容の2-3文の要約" },
    relevance: {
      type: "integer",
      description: "プロフィールとの関連度 0-100。専門家募集でないページ（事業者向け補助金案内等）は20以下",
    },
    relevance_reason: {
      type: ["string", "null"],
      description: "関連度の理由と、応募者が引っかかりそうな要件の注意点（1-2文）",
    },
  },
  required: ["title", "org", "status", "relevance"],
  additionalProperties: false,
} as const;

let client: Anthropic | undefined;

export async function llmExtract(
  pageText: string,
  url: string,
  profileSummary: string,
): Promise<ExtractedFields | undefined> {
  if (!env.anthropicApiKey) return undefined;
  client ??= new Anthropic({ apiKey: env.anthropicApiKey });

  const truncated = pageText.slice(0, 14_000);
  try {
    const response = await client.messages.create({
      model: env.claudeModel,
      max_tokens: 2048,
      system:
        "あなたは中小企業診断士向けの公的機関専門家募集情報を構造化するアシスタントです。" +
        "与えられたページ本文から募集情報を抽出し、指定スキーマのJSONで返します。" +
        "経験年数要件があっても除外判定はせず、requirementsにそのまま記録してください。",
      messages: [
        {
          role: "user",
          content: `## 応募者プロフィール\n${profileSummary}\n\n## ページURL\n${url}\n\n## ページ本文\n${truncated}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: EXTRACT_SCHEMA } },
    });
    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return undefined;
    return JSON.parse(text.text) as ExtractedFields;
  } catch (e) {
    console.error(`LLM extract failed for ${url}: ${String(e)}`);
    return undefined;
  }
}
