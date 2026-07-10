import { defineConfig } from "astro/config";

// GitHub Pages 配信設定。
// 公開URL: https://gucchi39.github.io/shindanshi_shigoto/
// （ユーザー名やリポジトリ名を変えた場合はここも変更する）
export default defineConfig({
  site: "https://gucchi39.github.io",
  base: "/shindanshi_shigoto",
  build: { format: "file" },
});
