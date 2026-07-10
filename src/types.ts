export type SourceCategory =
  | "national"
  | "prefecture"
  | "city"
  | "cci"
  | "guarantee"
  | "incubation"
  | "other";

export interface SourceConfig {
  id: string;
  name: string;
  category: SourceCategory;
  area: string;
  url: string;
  content_type?: "html" | "pdf";
  priority?: "high" | "medium" | "low";
  recruit_type?: string;
  notes?: string;
  /** リンク抽出に使う追加キーワード（デフォルトキーワードに加算） */
  link_keywords?: string[];
  /** このURLパターンを含むリンクは除外 */
  link_exclude?: string[];
  /** このキーワードをタイトルに含むリンクは除外（ソース固有ノイズ用） */
  title_exclude?: string[];
  /** 監視のみ（ページ変化を通知するがリンク抽出はしない） */
  watch_only?: boolean;
  disabled?: boolean;
}

export interface Profile {
  name: string;
  qualifications: string[];
  registered_at: string; // 診断士登録年月 (YYYY-MM)
  specialties: string[];
  areas: string[];
  area_keywords: string[];
  keywords: { word: string; weight: number }[];
  negative_keywords?: string[];
}

export type PostingStatus = "募集中" | "締切" | "通年" | "次回見込み" | "不明";

export interface Posting {
  id: string;
  title: string;
  org: string;
  source_id: string;
  category: SourceCategory;
  area: string;
  period_start?: string;
  deadline?: string; // YYYY-MM-DD
  status: PostingStatus;
  requirements?: string;
  /** 経験年数要件の検出結果。除外には使わない（表示のみ） */
  experience_requirement?: string;
  reward?: string;
  how_to_apply?: string;
  url: string;
  source_type: "listing" | "detail" | "pdf";
  fetched_at: string;
  first_seen: string;
  match_score: number;
  match_reason: string;
  summary?: string;
  llm_processed: boolean;
}

export interface SeenState {
  pages: Record<string, { hash: string; last_fetched: string }>;
  items: Record<string, { url: string; first_seen: string; source_id: string }>;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  contentType: "html" | "pdf";
  /** HTML: 生HTML / PDF: 抽出済みテキスト */
  body: string;
  /** HTMLの場合の本文テキスト（タグ除去済み） */
  text: string;
}

export interface CrawlFailure {
  source_id: string;
  url: string;
  error: string;
}

export interface ExtractedFields {
  title?: string;
  org?: string;
  period_start?: string;
  deadline?: string;
  status?: PostingStatus;
  requirements?: string;
  reward?: string;
  how_to_apply?: string;
  summary?: string;
  relevance?: number; // 0-100 LLM判定の関連度
  relevance_reason?: string;
}
