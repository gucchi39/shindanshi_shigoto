# shindanshi_shigoto

中小企業診断士向け「公的機関 案件 自動収集・マッチングツール」。

国・経済産業局・都道府県・市区町村・商工会議所・信用保証協会などに散在する
**専門家募集・登録・委嘱案件**を毎日自動巡回して、プロフィールとの適合度をスコアリングし、
新着と締切間近をSlackに通知します。

```
GitHub Actions (毎日06:30 JST)
  → 巡回 fetch (HTML/PDF, robots.txt尊重, 2秒/ホストのアクセス間隔)
  → 差分検知 (seen.json: ページハッシュ + 既知URL)
  → 構造化抽出 extract (新着のみ Claude API / ルールベースにフォールバック)
  → 適合度スコアリング score (エリア × 専門キーワード × 募集状態)
  → 保存 store (data/postings.json → リポジトリにコミット)
  → 通知 notify (Slack Webhook + data/report.md)
```

## セットアップ

1. リポジトリの **Settings → Secrets and variables → Actions** に登録:

   | Secret | 必須 | 内容 |
   |---|---|---|
   | `SLACK_WEBHOOK_URL` | 推奨 | Slack Incoming Webhook のURL。未設定なら通知スキップ（report.mdは生成される） |
   | `ANTHROPIC_API_KEY` | 任意 | 設定すると新着案件をClaudeで構造化抽出（締切・要件・報酬・関連度）。未設定ならルールベースのみで動作 |

2. Actionsタブから `crawl` ワークフローを **Run workflow** で手動実行（初回はDB作成のためのシーディング。新着が大量に出るのは正常）
3. 以降は毎日 06:30 JST に自動実行され、差分だけ通知されます

### ローカル実行

```bash
npm install
npm run crawl:dry                       # 通知・保存なしのお試し実行
npm run crawl                           # 本実行
npx tsx src/main.ts --source=tokyo-kosha-senmonka   # 1ソースだけ
```

## 設定ファイル

### `config/sources.yaml` — 監視対象（現在57機関）

国レベル（中小企業119・中小機構公募・よろず全国本部・スマートSMEサポーター等）／栃木・茨城・埼玉・東京の中核支援機関＋よろず／商工会議所（拠点近郊の小山・古河・結城・筑西・足利・佐野・真岡・川口ほか）／信用保証協会／23区の産業振興財団などを定義。

```yaml
- id: tokyo-kosha-senmonka
  name: 東京都中小企業振興公社 専門家募集
  category: prefecture        # national / prefecture / city / cci / guarantee / incubation / other
  area: 東京都
  url: https://www.tokyo-kosha.or.jp/kosha/senmonka-bosyu/index.html
  priority: high              # high=重点監視の目印 / low=期待値低め
  watch_only: false           # trueならページ更新のみ通知（リンク抽出しない）
  link_keywords: []           # リンク抽出キーワードの追加
  link_exclude: []            # 除外するURLパターン
  disabled: false             # 一時停止
```

機関の追加はこのファイルに追記するだけ。URLが死んだり構造が変わって取得に失敗すると
Slackの「取得失敗」に出るので、黙って0件になることはありません。

### `config/profile.yaml` — マッチング基準

資格・専門領域・活動エリア・キーワード重みを定義。編集すれば次回巡回から反映。

## スコアリングの考え方（0-100）

| 要素 | 配点 | 内容 |
|---|---|---|
| エリア一致 | 〜25 | 栃木/茨城/埼玉/東京=25、全国=20、対象外は0 |
| 専門キーワード | 〜40 | AI/DX/新規事業/生産性向上/製造業… の重み付き一致 |
| 募集ステータス | 〜20 | 募集中 > 通年 > 不明 > 次回見込み > 締切 |
| LLM関連度 | 〜15 | Claude判定の関連度（APIキー設定時のみ） |
| ネガティブ | -15 | 職員採用・工事等のノイズを減点 |

**重要ルール: 経験年数要件（例: 登録後5年以上）では自動除外しません。**
要件は `requirements` / `experience_requirement` にそのまま記録し、
`⚠年数要件あり(未充足の可能性・応募可否は要確認)` として表示だけします。応募判断は人間がやる。

## 通知

- **新着**: スコア順に最大15件をSlackへ（全量は `data/report.md`）
- **締切リマインド**: 締切14日前・3日前・当日
- **取得失敗**: サイト構造変更の検知を兼ねる

## コスト・運用メモ

- LLM抽出は**差分検知した新着のみ**、1回の巡回で最大25件（`MAX_LLM_CALLS`で変更可）
- モデルは既定で `claude-opus-4-8`。コストを抑えるならworkflowの `CLAUDE_MODEL: claude-haiku-4-5` を有効化
- アクセスは同一ホスト2秒間隔・1日1回。robots.txt のDisallowを尊重

## ダッシュボード（web/）

`data/postings.json` を可視化するAstro静的サイト。締切間近バンド・サマリー・カテゴリ絞り込み・スコア/締切ソートつき。

- **公開URL（GitHub Pages）**: https://gucchi39.github.io/shindanshi_shigoto/
- ローカル確認: `cd web && npm install && npm run build`（`dist/`に出力）

### 初回セットアップ（一度だけ）

リポジトリの **Settings → Pages → Build and deployment → Source** を **「GitHub Actions」** に設定するだけ。
以降は `deploy-pages` ワークフローが自動で:

- 毎日の `crawl` 完了後（データ更新後）にダッシュボードを再ビルド＆デプロイ
- `web/` のデザインを変更してpushしたときも再デプロイ

外部サービス不要・追加Secret不要。詳細は [`web/README.md`](web/README.md)。

## 既知の制約 / 今後の拡張

- 一部サイトはJavaScriptレンダリングが必要な可能性 → 失敗通知が続くソースは個別対応（headless化 or watch_only化）
- sources.yaml のURLは主要どころをWeb検索で実在確認済みだが、初回実行の「取得失敗」通知が最終検証を兼ねる
- 拡張候補: Notion DB連携（store.tsに追加） / Astro + Cloudflare Pages のダッシュボード / 対象機関の追加（sources.yamlに追記するだけ）
