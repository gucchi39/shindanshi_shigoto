import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { Posting, SeenState } from "./types.js";

const DATA_DIR = "data";
const POSTINGS_PATH = `${DATA_DIR}/postings.json`;
const SEEN_PATH = `${DATA_DIR}/seen.json`;

export function loadPostings(): Posting[] {
  if (!existsSync(POSTINGS_PATH)) return [];
  return JSON.parse(readFileSync(POSTINGS_PATH, "utf-8")) as Posting[];
}

export function savePostings(postings: Posting[]): void {
  mkdirSync(DATA_DIR, { recursive: true });
  const sorted = [...postings].sort((a, b) => b.match_score - a.match_score);
  writeFileSync(POSTINGS_PATH, JSON.stringify(sorted, null, 2) + "\n");
}

export function loadSeen(): SeenState {
  if (!existsSync(SEEN_PATH)) return { pages: {}, items: {} };
  return JSON.parse(readFileSync(SEEN_PATH, "utf-8")) as SeenState;
}

export function saveSeen(seen: SeenState): void {
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SEEN_PATH, JSON.stringify(seen, null, 2) + "\n");
}

/** 新規は追加、既存は最新情報で更新（first_seenは維持） */
export function upsertPostings(existing: Posting[], updates: Posting[]): Posting[] {
  const byId = new Map(existing.map((p) => [p.id, p]));
  for (const p of updates) {
    const prev = byId.get(p.id);
    byId.set(p.id, prev ? { ...p, first_seen: prev.first_seen } : p);
  }
  return [...byId.values()];
}
