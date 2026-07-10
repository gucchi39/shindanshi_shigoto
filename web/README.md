# web — 案件ダッシュボード（Astro）

`data/postings.json` を読み込んで静的HTMLを生成するダッシュボード。
締切間近バンド・サマリー統計・カテゴリ絞り込み・スコア/締切の並び替えつき。

## ローカル確認

```bash
cd web
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/ に静的出力
```

`data/postings.json`（親ディレクトリ）をビルド時に読むので、
本体クローラーを一度動かして `data/postings.json` がある状態でビルドしてください。

## Cloudflare Pages で常設URLにする（毎日自動更新）

一度つなぐだけ。以降は毎日の巡回コミットで自動リビルドされます。

1. [Cloudflare Pages](https://dash.cloudflare.com/) → **Create application → Pages → Connect to Git**
2. このリポジトリ `gucchi39/shindanshi_shigoto` を選択
3. ビルド設定:
   | 項目 | 値 |
   |---|---|
   | Production branch | クローラーが巡回結果を push するブランチ（例: `main`） |
   | Framework preset | Astro |
   | Root directory | `web` |
   | Build command | `npm run build` |
   | Build output directory | `dist` |
4. **Save and Deploy** → `https://<プロジェクト名>.pages.dev` が発行される

`.github/workflows/crawl.yml` が毎日 `data/` に push するたびに Cloudflare Pages が
自動でリビルドし、ダッシュボードが最新になります（追加のSecret設定は不要）。

## GitHub Pages を使う場合（Cloudflareを使わない代替）

`astro.config.mjs` の `site` / `base` を設定してビルドし、`dist/` を
`gh-pages` ブランチ等に配置して GitHub Pages で配信することも可能です。
その場合は crawl.yml にビルド＆デプロイのステップを追加してください。
