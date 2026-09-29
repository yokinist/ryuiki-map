# 参加のしかた

流域探索マップへの参加を歓迎します。不具合の報告・改善の提案・Pull Request のどれでも助かります。

## 不具合の報告・提案

[Issue](https://github.com/yokinist/ryuiki-map/issues/new/choose) から、ひな形（不具合の報告・改善の提案）を選んでください。

流れの向きがおかしい地点を報告するときは、その地点の共有 URL（「この結果を共有する」で得られる `?p=経度,緯度` 付きの URL）を添えてもらえると再現できます。

## Issue に取り組む

1. 着手する前に、その Issue にコメントしてください。作業の重複を防ぐためです
2. 分からないことは、Issue のコメントで気軽に聞いてください

## 開発の準備

手順とコマンドは [README の「開発」](README.md#開発) にあります。

- 河川データ（`public/rivers/`）と流域サマリ用のデータ（`public/karte/`）は生成済みのものがリポジトリに入っているので、`pnpm install && pnpm dev` だけで動きます
- データを作り直すスクリプト（`pnpm build:rivers`・`pnpm build:karte`）は、公開 API に長時間問い合わせます。Issue で必要とされたときだけ実行してください。手元のキャッシュにある分だけで全体を書き出すので、一部だけ取ると他の地域のデータが消えます
- 計算のしくみは [README の「しくみ」](README.md#しくみ) にあります

## 書き方の決まり

詳しくは [AGENTS.md](AGENTS.md) にあります（人もエージェントも同じ決まりで書きます）。要点は次のとおりです。

- コメント・画面の文言・テスト名は日本語。画面では専門用語を言い換える（流路 →「雨の通り道」など）
- 色・文字サイズ・余白・時間は `src/client/styles/tokens.css` だけで定義する
- サイト名・説明・URL は `site.config.ts` だけに置く
- テストは、失敗するものを先に書いてから実装する。DOM・Web Worker・通信に依存しない純粋な部分を切り出してテストする
- 地図を自動で動かすときは、急に飛ばさず、なめらかに動かす
- 計算の前提やデータの出どころを変えたら、画面の「アプリについて・利用上の注意」「出典・ライセンス」、`site.files.ts`（`/llms.txt`）、README の「出典・ライセンス」を揃える

## Pull Request

- コミットメッセージは [Conventional Commits](https://www.conventionalcommits.org/ja/v1.0.0/)（`feat:`・`fix:`・`docs:` など）で、題名は日本語で書いてください
- PR を出す前に、次が通ることを確かめてください。`index.html`・`vite.config.ts`・`site.*.ts`・`wrangler.jsonc` を触ったときは `pnpm build` も

  ```sh
  pnpm typecheck && pnpm check && pnpm test
  ```

- PR のひな形に沿って、手で確かめたこと（試した地点の URL やスクリーンショット）を書いてください
- PR を出すと、GitHub Actions で型チェック・Lint・テスト・ビルドが走ります
- 同じリポジトリのブランチからの PR には、[AGENTS.md](AGENTS.md) の決まりに沿った自動レビュー（Claude Code Action）が付きます。フォークからの PR では、メンテナが `@claude review` とコメントして起動します。自動レビューは参考で、最終的な判断はメンテナが行います
- `main` にマージされると、そのまま本番（https://ryuiki-map.ykns.workers.dev/）に自動で公開されます
- Cloudflare への公開や、そのための設定（トークンなど）が必要な確認は、メンテナが行います

## ライセンス

送ってもらったソースコードは、このリポジトリと同じ [MIT License](LICENSE) で公開されます。地図データは MIT ではなく、それぞれのライセンスに従います（[NOTICE.md](NOTICE.md)）。

## 連絡先

Issue で扱いにくいこと（データの利用に関する問い合わせなど）は info@yokinist.me までご連絡ください。
