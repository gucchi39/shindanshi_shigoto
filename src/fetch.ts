import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import type { FetchResult } from "./types.js";

const USER_AGENT =
  "shindanshi-shigoto-crawler/0.1 (+https://github.com/gucchi39/shindanshi_shigoto; low-frequency public-info crawler)";

const FETCH_TIMEOUT_MS = 30_000;
const HOST_DELAY_MS = 2_000;

const lastAccess = new Map<string, number>();
const robotsCache = new Map<string, string[]>();

async function politeWait(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastAccess.get(host) ?? 0;
  const wait = last + HOST_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAccess.set(host, Date.now());
}

/** robots.txt の User-agent:* の Disallow を確認（簡易実装） */
async function isAllowedByRobots(url: string): Promise<boolean> {
  const u = new URL(url);
  let disallows = robotsCache.get(u.host);
  if (disallows === undefined) {
    disallows = [];
    try {
      const res = await fetch(`${u.origin}/robots.txt`, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const text = await res.text();
        let applies = false;
        for (const line of text.split("\n")) {
          const [rawKey, ...rest] = line.split(":");
          const key = rawKey.trim().toLowerCase();
          const value = rest.join(":").trim();
          if (key === "user-agent") applies = value === "*";
          else if (applies && key === "disallow" && value) disallows.push(value);
        }
      }
    } catch {
      // robots.txt が取れない場合は許可とみなす
    }
    robotsCache.set(u.host, disallows);
  }
  return !disallows.some((d) => u.pathname.startsWith(d));
}

function htmlToText(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, nav, header, footer, noscript, iframe").remove();
  return $("body").text().replace(/[ \t　]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export async function fetchPage(url: string): Promise<FetchResult> {
  if (!(await isAllowedByRobots(url))) {
    throw new Error(`robots.txt disallows: ${url}`);
  }
  await politeWait(url);

  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/pdf,*/*" },
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const contentType = res.headers.get("content-type") ?? "";
      const isPdf = contentType.includes("pdf") || new URL(res.url).pathname.toLowerCase().endsWith(".pdf");

      if (isPdf) {
        const buf = new Uint8Array(await res.arrayBuffer());
        const pdf = await getDocumentProxy(buf);
        const { text } = await extractText(pdf, { mergePages: true });
        const merged = (Array.isArray(text) ? text.join("\n") : text).trim();
        return { url, finalUrl: res.url, contentType: "pdf", body: merged, text: merged };
      }

      const html = await res.text();
      return { url, finalUrl: res.url, contentType: "html", body: html, text: htmlToText(html) };
    } catch (e) {
      lastError = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 3_000));
    }
  }
  throw new Error(`fetch failed: ${url} (${String(lastError)})`);
}
