# web — 案件ダッシュボード（Astro）

`data/postings.json` を読み込んで静的HTMLを生成するダッシュボード。
締切間近バンド・サマリー統計・カテゴリ絞り込み・スコア/締切の並び替えつき。

**公開URL: https://gucchi39.github.io/shindanshi_shigoto/**

## ローカル確認

```bash
cd web
npm install
npm run dev      # http://localhost:4321/shindanshi_shigoto/
npm run build    # dist/ に静的出力
```

`data/postings.json`（親ディレクトリ）をビルド時に読むので、
本体クローラーを一度動かして `data/postings.json` がある状態でビルドしてください。

## GitHub Pages で常設URLにする（毎日自動更新）

一度だけ設定すれば、以降は完全自動。外部サービス不要。

1. リポジトリの **Settings → Pages** を開く
2. **Build and deployment → Source** を **「GitHub Actions」** に変更（これだけ）

以降は `.github/workflows/deploy-pages.yml` が自動でビルド＆デプロイします:

- 毎日の `crawl` ワークフロー完了後（＝`data/` 更新後）にダッシュボードを再デプロイ
- `web/` 配下を変更して push したときも再デプロイ
- Actions タブから手動実行も可

公開URLは `https://<ユーザー名>.github.io/<リポジトリ名>/`。
ユーザー名・リポジトリ名を変えた場合は `astro.config.mjs` の `site` / `base` も合わせて変更してください。

## 仕組み

```
毎日06:30  crawl → data/ にコミット&push
                     │  (workflow_run: crawl 完了を検知)
                     ▼
           deploy-pages → web/ をビルド → GitHub Pages へ公開
                     ▼
           https://gucchi39.github.io/shindanshi_shigoto/ が最新に
```
