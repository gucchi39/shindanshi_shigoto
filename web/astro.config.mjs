import { defineConfig } from "astro/config";

// 静的サイト（Cloudflare Pages / GitHub Pages どちらでも配信可）
export default defineConfig({
  // GitHub Pages で配信する場合はここを "https://gucchi39.github.io" 等に、
  // base を "/shindanshi_shigoto" に設定する。Cloudflare Pages なら不要。
  build: { format: "file" },
});
