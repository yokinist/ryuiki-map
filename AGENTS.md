# AGENTS.md

構成・コマンド・計算のしくみは README.md にある。ここには、コードや設定から読み取りにくい決まりだけを書く。

## 仕上げ

変更を終えたら `pnpm typecheck && pnpm check && pnpm test` を通す。`index.html`・`vite.config.ts`・`site.*.ts`・`wrangler.jsonc` を触ったら `pnpm build` も（CI は4つとも走らせる）。計算（`terrain/`・`data/`）・データ（`public/rivers/`・`public/karte/`）・画面の流れを触ったら `pnpm test:e2e`（ブラウザで代表地点の結果を確かめる。数分かかる。CI ではそれらが変わった PR でだけ走る）。

## 公開

`main` に push すると、GitHub Actions が CI（型チェック・Lint・テスト・ビルド）のあとに Cloudflare Workers へデプロイする（`.github/workflows/ci.yml`）。手元の `pnpm deploy` は、Actions を待たずに出したいときだけ使う。同じリポジトリのブランチからの PR では、本番とは別の版をプレビュー（`pr-<番号>-ryuiki-map.ykns.workers.dev`）として出し、URL を PR にコメントする（フォークからの PR では出ない）。

## 書き方

- コメント・UI の文言・テスト名は日本語。UI では専門用語を言い換える（流路 →「雨の通り道」）。ただし「集水域」はそのまま使い、意味は「？」の説明で補う（`ui/dom.ts` の `helpButtonAndText`）
- コメントはコードから読めない理由・前提だけを1〜2行で
- `// ponytail:` は意図して簡略化した箇所の印。直すときは印ごと消し、残すときは理由を保つ
- 色・文字サイズ・余白・時間は `src/client/styles/tokens.css` だけで定義する。TS からは `map/theme.ts` の `token` / `pixel` / `rgba` / `tokenMs` で読む
- サイト名・説明・URL は `site.config.ts` が唯一の置き場。`index.html` では `{{キー}}` で差し込む
- コミットメッセージは Conventional Commits（`feat:` `fix:` など）。題名は日本語

## 地図の動き

- 地図の表示（中心・ズーム）は、利用者の操作以外で不連続に変えない。自動で動かすときは必ず徐々に、速さも0から滑らかに上げ下げする。雨粒などの印の位置は多少ずれてよいが、地図そのものは急に動かさない（動きを減らす設定のときだけは一度に合わせてよい）
- 動きの切り替え（寄せる → 追いかける → 着地）で、1フレームでも止めたり、目標を急に飛ばしたりしない。追いかけは `ui/camera.ts` の2段のなめらかさ（目標を徐々に動かし、表示がそれを追う）に任せる
- `easeTo` / `flyTo` に `padding` を渡さない。地図に残り続け、以後の `cameraForBounds` で二重に効いて目標が飛ぶ。パネルを避けた中心は `cameraForBounds` で求めて `center` で渡す
- 動きを変えたら、`requestAnimationFrame` で毎フレームの中心・ズームを記録し、フレーム間の速さの変化に飛びがないか確かめる

## テスト

基本 **TDD**（赤 → 緑）。1つの振る舞いにつき、失敗するテストを先に書き、通る最小の実装だけ足す。テストをまとめ書きしてから実装するのではなく、**縦に1本ずつ**（テスト1本 → 実装 → 次のテスト）進める。リファクタは緑のあと。

- 対象の隣に `*.test.ts`。テストするのは DOM・Worker・通信を使わない純粋なロジック（`vitest.config.ts` は Cloudflare プラグインなしの Node 環境）
- テストから import できるのは、読み込んだだけで副作用が起きないモジュール。`terrain/grid.ts` は Web Worker を起動し、`ui/rain.ts`・`ui/camera.ts` は maplibre-gl を読むので対象外。そこで使う計算は `grid-spec.ts`・`timeline.ts` のような純粋なモジュールに **先に切り出して** テストする
- 期待値は仕様・手計算・既知の例から置く。実装と同じ式をテスト側で写すだけの断言は避ける
- DOM・地図・Worker の結合は TDD の対象外。そこは手動または既存の `pnpm test` で守った **純粋部分の seam** を厚くする

## データと外部サービス

- `public/rivers/` は `pnpm build:rivers` の生成物だが git で管理する（作り直したらコミットする。古い版のフォルダはスクリプトが消す）。変換のやり直しは `pnpm build:rivers --pack`。引数なしの全国取得は Overpass API に40〜60分問い合わせ続けるので、頼まれたときだけ走らせる。頼まれても、本当に取り直す必要があるか（`--pack` での変換のやり直しで足りないか）を先に確かめる
- 地理院の逆ジオコーダへの問い合わせは `config.ts` の `GEOCODER`（同時4件）と、`data/places.ts` の間引き（川の区間ごとに最大3地点）の範囲に収める
- `public/karte/` は `pnpm build:karte` の生成物だが git で管理する（`public/rivers/` と同じ）。まとめ直しは `pnpm build:karte --pack`。全国の取得は e-Stat・WorldCover・Overpass に約1時間問い合わせる（取得済みの分は `.cache/` から再利用する）ので、頼まれたときだけ走らせる。頼まれても、本当に取り直す必要があるか（`--pack` でのまとめ直しで足りないか）を先に確かめる
- どちらも、作り直しは `.cache/`（git 管理外）にある取得済みの分だけで全体を書き出す。キャッシュが一部しかない状態で走らせると他の地域が消えるので、コミット前に `git status` でファイルが大量に消えていないか確かめる（戻すときは `git restore public/rivers public/karte`）
- 流域サマリの降水量（Open-Meteo）は、サマリを開いたときだけ1回問い合わせる。地図を動かすたびに問い合わせるような使い方はしない（無料枠は非商用・1日1万回）
- OSM 由来の河川データは ODbL。地図の出典表示（`config.ts` の `ATTRIBUTION`）と、河川タイルに添える `README.txt` を保つ

## 利用者向けの説明を揃える

計算の前提（流速・メッシュ・対象範囲）やデータの出どころを変えたら、同じ内容を書いた次の箇所を揃える。

- `index.html` の「アプリについて・利用上の注意」「出典・ライセンス」
- `site.files.ts`（AI 向けの説明 `/llms.txt`）
- `README.md` の「出典・ライセンス」
