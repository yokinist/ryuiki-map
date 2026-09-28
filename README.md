# 流域探索マップ(β)

**https://ryuiki-map.ykns.workers.dev/**

[![流域探索マップ — ここに降った雨は、どこの海へ？](public/og.png)](https://ryuiki-map.ykns.workers.dev/)

ある地点に降った雨が、どの川と集落を通って海へ向かうかをたどれる探索マップ。日本全国に対応。地点をクリックすると雨粒が川を下り、合流する川・通過するダムと堰・通過する地区（大字）が時系列に並ぶ。`?p=経度,緯度` 付きの URL を開くと、その地点の水の流れを再生する（`&dir=up` も付いていれば、下る動きは見せずに水源へさかのぼる）。

雨が着いたら「上流へさかのぼる」で、その地点の水がどこから来たか（通る川・流れ込む主な支流・地区・水源）をたどれる。「流域サマリを見る」で、海までの距離と通り道の土地の使われ方、およびその地点より上流（集水域）の面積・標高・人口の推移・年間降水量・ダムと堰・川を1枚にまとめて出す。

キーボードだけでも使える: Tab で地図を選ぶと照準が出て、矢印キーで移動、+/- で拡大・縮小、Enter で照準の位置に降った雨の流れをたどる。

## 参加する

不具合の報告や「この地点の流れがおかしい」「こんな使い方をしたい」といった提案は [Issue](https://github.com/yokinist/ryuiki-map/issues) へ。Pull Request も歓迎します。

流れの向きがおかしい地点を報告するときは、その地点の共有URL（`?p=経度,緯度` 付き）を添えてもらえると再現できます。PR の前に `pnpm test`・`pnpm typecheck`・`pnpm check` が通ることを確認してください。

## 開発

```sh
pnpm install
pnpm dev
```

河川データ（`public/rivers/`）と流域サマリ用のデータ（`public/karte/`）は生成済みのものがリポジトリに入っているので、データを作らずにそのまま動く。

データの作り直しは、全国分を取り直すときだけ行う（公開 API に長時間問い合わせる）。スクリプトは手元のキャッシュ（`.cache/`、git 管理外）にある分だけで全体を作り直すので、クローン直後に一部のタイルやメッシュだけ取ると、ほかの地域のデータが消える。消えたら `git restore public/rivers public/karte` で戻せる。

```sh
pnpm build:rivers       # 全国の河川線を OpenStreetMap（Overpass API）から取り直す（40〜60分）
pnpm build:karte        # 流域サマリ用の人口・土地・ダムのデータを作り直す（約1時間）
```

| コマンド | 内容 |
| --- | --- |
| `pnpm test` | ユニットテスト（Vitest） |
| `pnpm typecheck` | 型チェック |
| `pnpm check` / `pnpm format` | Lint・整形（Biome） |
| `pnpm build:rivers [タイル…\|--pack]` | 河川データの取得と配信用タイルへの変換。引数なしなら全国のうち未取得の1°タイルだけ取る（途中から再開できる）。`139_36` のように指定するとそれだけ取り直す。どちらも変換は取得済みの全タイルで行う。`--pack` は取得せず変換だけやり直す |
| `pnpm build:karte [1次メッシュ…\|--pack]` | 流域サマリ用のデータ。e-Stat の国勢調査1kmメッシュ（2010・2015・2020年の人口）、ESA WorldCover（土地の使われ方）、OSM のダム・堰を取得し、1次メッシュ（約80km四方）ごとのファイルにまとめる。途中から再開できる。`5339` のように指定するとそれだけ取る。どちらもまとめは取得済みの全メッシュで行う。`--pack` は取得せずまとめ直す |
| `pnpm build:seas` | 河口がどの海かを判定する海域データ（`public/seas.json`、約140KB）を作る。1回きりでよい |
| `pnpm build:og` | 共有時の画像 `public/og.png` を `site.config.ts` の `name`・`stage`・`ogTagline` で描き直す（右の地図は `assets/og-map.png`）。文字は macOS のヒラギノで描く |
| `pnpm build:hill` | 陰影起伏図で海だけのタイル（404 になる）の一覧（`src/client/map/hill-missing.json`）を作る。問い合わせずに済ませてコンソールのエラーを減らす。1回きりでよい |
| `pnpm deploy` | ビルドして Cloudflare Workers へ公開 |

## しくみ

1. 表示範囲の標高タイル（地理院 dem_png）を読み、Priority-flood で各セルの流向を計算する（`terrain/`、Web Worker で実行）
   - 計算するのは、拡大して地図を止め、見えている地図のタイルを読み終えたときの表示範囲（マウス位置からの流れの先読み用。表示中の地図と回線を取り合わないよう後回しにする）と、まだ計算していない場所をクリックしたときのその周り（約25km四方）
2. 平野で流れが迷わないよう、OSM の河川線に沿って計算用の標高を下げておく（焼き込み。長い川ほど深く。川の長さは OSM の waterway リレーションか、同じ名前でつながった線の合計から求める）
   - 河口が砂州でふさがっている場所やダム湖の手前では、川筋が海につながらず埋められて平らになる。その中では元の標高が低いセル（深く焼き込んだ本流）を優先して道筋をつなぐので、並行する支流に流れが逸れない
3. クリック地点から下流へたどり、計算範囲の端に出たら、その先の広域グリッド（約120mメッシュ）を読み込んで河口まで続ける（`terrain/trace.ts`）
4. 流路沿いの川の名前は焼き込んだ河川線から、地区名は地理院の逆ジオコーダから引く（`data/rivers.ts` / `data/places.ts`）
5. 流域サマリは、クリック地点より上流のセル（集水域）を数え、各セルが入る1kmメッシュ（JIS X 0410 の3次メッシュ）ごとの面積を出して、メッシュの人口を面積で按分し、土地の割合を面積で重み付けして合計する（`data/karte.ts` / `data/karte-stats.ts`）
   - 長さは、クリック地点から河口までの雨の通り道の距離（パネルの距離と同じ）。添えて、範囲の中でいちばん遠い水源からクリック地点までを流向（`down`）に沿ってたどった距離（`longestFlowKm`）も出す
   - 範囲が細かいグリッドの端に届くときは、広域グリッド（約190km四方）で数え直す。それでも端に届くなら「端で切れている」と表示する
   - 年間降水量は範囲の中心1地点について Open-Meteo（ERA5 再解析）の1991〜2020年の日降水量を平均する
6. 雨の通り道・水の来た道のダム・堰は、流域サマリ用のダム・堰のデータから、流路から約250m以内のものを拾う（名前のない堰は数が多いので除く。`damsNearPath`）
7. 上流へさかのぼるときは、クリック地点より上流でいちばん遠い水源（流向に沿った長さが最大のセル）まで行く。上流から順に「いちばん遠い水源までの長さ」を下流へ渡し、どの流れから来たかをたどり返す（`terrain/hydro.ts` の `farthestStem`。流域サマリの「水源からの長さ」と同じ道のり）。途中で脇から流れ込む流れのうち、集水域が5km²以上かつ合流点の本流の10%以上で名前のあるものを、主な支流として出す（`tributaries`）。グリッドは流域サマリと同じく、集水域が端で切れないものを選ぶ（`terrain/trace.ts` の `traceToSource`）
   - 集水域が10km²未満の地点（小さな水路）は、近くの雨がほとんどだと添える。水源との高低差が30m未満の平地では、川から引いた用水は地形からたどれないことを添える

## 構成

```
src/client/              ページ（ブラウザ側）
  main.ts                起動・地図・操作のつなぎ込み
  config.ts              起動時の表示範囲・計算範囲・データの URL などの設定
  geo.ts                 経緯度・範囲の型と小さな関数
  terrain/               地形と水の流れの計算
    grid-spec.ts         計算グリッドの定義（標高タイルの並びに合わせる）
    dem.ts               地理院の標高タイルの読み込み
    hydro.ts             流向・集水域の計算（純粋関数）
    grid.worker.ts       グリッドづくり（標高・河川の読み込み、焼き込み、流向計算）を行う Web Worker
    grid.ts              Worker の呼び出しと、読み込み済みグリッドの管理
    trace.ts             河口までの流路（グリッドの端では隣のグリッドに乗り換える）と、水源までさかのぼる道のり
  data/                  外部データ
    rivers.ts            河川の表示・焼き込み・名前の参照
    river-format.ts      配信用の河川タイルの形式（scripts と共有）
    places.ts            地名（地理院の逆ジオコーダ）
    seas.ts              河口がどの海か
    karte.ts             流域サマリの集計（範囲の数え直し・メッシュデータの読み込み・降水量の問い合わせ）
    karte-stats.ts       流域サマリの計算（按分・割合。純粋関数）
    karte-format.ts      流域サマリのデータ形式と地域メッシュの計算（scripts と共有）
  map/                   地図の描画
    overlays.ts          地図に重ねるレイヤーと画像
    theme.ts             CSS のデザイントークンを地図の描画色に使う
    hill.ts              陰影起伏図のタイルを、海だけのタイルを飛ばして読む
    sea-tiles.ts         海だけのタイルの一覧（hill-missing.json）の引き方
  ui/                    画面
    rain.ts              雨粒の再生と、時系列・まとめ・上流へのさかのぼりの表示
    karte.ts             流域サマリの画面（カードを並べて比べる）
    camera.ts            雨粒を追うカメラ
    layout.ts            パネルに隠れない地図の範囲の計算
    motion.ts            雨粒の進め方（イージング・再生時間）
    timeline.ts          時系列の部品
    dom.ts               DOM ヘルパー
    format.ts            距離・時間・面積の表示形式
  styles/                tokens.css（デザイントークン）と app.css
scripts/                 データの作成（河川: build-rivers.ts、流域サマリ: build-karte.ts、海域: build-seas.ts、陰影の欠けタイル: build-hill-index.ts、共有時の画像: build-og.ts、Overpass API の問い合わせ: overpass.ts）
assets/                  配信しない素材（共有時の画像の右側の地図 og-map.png）
public/                  静的ファイル（seas.json、_headers、地図の欧文フォント fonts/、アイコン・OGP 画像。河川タイル rivers/ と流域サマリ karte/ は生成物だが git で管理する）
site.config.ts           サイト名・説明・URL・構造化データ。index.html の {{キー}} に差し込む
site.files.ts            robots.txt・sitemap.xml・llms.txt（AI 向けのサイト説明）。ビルド時に書き出す
wrangler.jsonc           Cloudflare Workers の設定。静的アセットを配るだけで Worker のコードは持たない
.github/                 CI（型チェック・Lint・テスト・ビルド）と Issue・PR のひな形
```

テストは対象ファイルの隣に `*.test.ts` として置く。

色・文字サイズ・余白は `src/client/styles/tokens.css` だけで定義し、地図の描画色もそこから読む。

## 出典・ライセンス

ソースコードは [MIT License](LICENSE)。地図データは以下のとおりそれぞれ別のライセンス。

- [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（白地図・淡色地図・陰影起伏図・標高タイル）、地理院 逆ジオコーダ（国土地理院）
- 河川線と名前: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)）
- 海域: Flanders Marine Institute (2018). IHO Sea Areas, version 3（[Marine Regions](https://www.marineregions.org/)、CC BY 4.0）。日本周辺で切り抜き・簡略化して `public/seas.json` にしている（`pnpm build:seas`）
- 流域サマリの人口: 「国勢調査」2010・2015・2020年 3次メッシュ（1kmメッシュ）人口総数（総務省統計局、[e-Stat](https://www.e-stat.go.jp/gis)）。[政府標準利用規約（第2.0版）](https://www.e-stat.go.jp/terms-of-use)に基づき加工して利用（秘匿値は0として集計）
- 流域サマリの土地の使われ方: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium（[ESA WorldCover](https://esa-worldcover.org/)、CC BY 4.0）。約70mに縮小した版から1kmメッシュごとの分類の割合にしている
- 流域サマリの年間降水量: [Weather data by Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0。Copernicus Climate Change Service の ERA5 を含む）。表示のたびにブラウザから問い合わせる
- ダム・堰（流域サマリ・雨の通り道）: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（ODbL 1.0）。ライセンスの違うデータを同じファイルに混ぜないよう、流域サマリのデータ（`public/karte/<版>/`）は人口・土地（`meshes/`）と OSM 由来のダム・堰（`dams/`、ODbL）に分け、それぞれに出典とライセンスを書いた `README.txt` を添えて配信する

### 利用条件を満たしている根拠

| 対象 | ライセンス・規約 | 求められること | このアプリでの対応 |
|---|---|---|---|
| 地理院タイル（白地図・淡色地図・陰影起伏図・標高タイル） | [国土地理院コンテンツ利用規約](https://www.gsi.go.jp/kikakuchousei/kikakuchousei40182.html) | 出典の明示（申請不要） | 地図右下に「地理院タイル」を一覧ページへのリンク付きで表示（`config.ts` の `ATTRIBUTION.gsi`）。アプリ内の「出典・ライセンス」にも記載 |
| 地理院 逆ジオコーダ | 同上 | 出典の明示 | 地図右下とアプリ内に記載。問い合わせ数は「外部サービスへの配慮」のとおり絞っている |
| OSM の河川線・名前 | ODbL 1.0 | ①出典表示 ②派生データベースを同じ ODbL で提供 | ①地図右下に「© OpenStreetMap contributors」を著作権ページへのリンク付きで表示（`ATTRIBUTION.rivers`）。OG 画像にも記載 ②変換したタイルを `/rivers/` で公開し、出典・ライセンス・加工内容を書いた `/rivers/README.txt` を添える |
| OSM のダム・堰 | ODbL 1.0 | 同上 | ①同上 ②`/karte/<版>/dams/` に分けて公開し、`dams/README.txt` を添える。ODbL 以外のデータと同じファイルに混ぜない |
| 国勢調査 1kmメッシュ人口（e-Stat） | [政府標準利用規約（第2.0版）](https://www.e-stat.go.jp/terms-of-use)（CC BY 4.0 互換） | 出典の記載と、加工した旨の明示 | アプリ内と `/karte/<版>/meshes/README.txt` に「出典：政府統計の総合窓口(e-Stat)」「〜を加工して作成」と記載 |
| ESA WorldCover | CC BY 4.0 | 所定の出典文言と、改変した旨 | 所定の文言（© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data…）をアプリ内と `meshes/README.txt` に記載し、1kmメッシュに集計した旨も書いている |
| IHO Sea Areas（Marine Regions） | CC BY 4.0 | 出典表示と、改変した旨 | アプリ内に出典と「日本周辺で切り抜き・簡略化して使用」を記載（`/seas.json`） |
| Open-Meteo の降水量 | CC BY 4.0。無料 API は非商用のみ | 出典表示。商用なら有料プラン | アプリ内に「Weather data by Open-Meteo.com」をリンク付きで記載。広告・課金のない非商用のアプリ |
| MapLibre GL JS | BSD-3-Clause | ビルド済みで再配布するときは著作権表示とライセンス文を添える | ビルドで同梱ライブラリのライセンス文を `/licenses.md` に書き出し（`vite.config.ts` の `build.license`）、アプリ内からリンク |
| 欧文フォント（Open Sans Semibold） | Apache License 2.0（[openmaptiles/fonts](https://github.com/openmaptiles/fonts)） | 再配布するならライセンス文を添える | 地図の文字用に変換した版（[maplibre/demotiles](https://github.com/maplibre/demotiles)）を `/fonts/` で配信し、ライセンス文 `/fonts/Open Sans Semibold/LICENSE.txt` を添える |
| OG 画像の文字（ヒラギノ角ゴシック） | macOS 同梱フォント | 画像にした文字はフォントの再配布にあたらない | 画像として描いただけで、フォントファイルは含めていない |
| 開発用ツール（Vite・Biome・Vitest・wrangler・geotiff など） | MIT など | — | 配信物に含まれない（`dist/licenses.md` に出てこない） |

ライセンス違反ではないが、変わりうる前提:

- **Open-Meteo**: 無料で使えるのは非商用の間だけ。広告を載せるなど商用にするなら有料プランに切り替える
- **地理院の逆ジオコーダ**: 地理院地図の内部で使われているもので、仕様が文書化された公開 API ではない。予告なく変わることがある

日本の河川線の多くは「国土数値情報（河川データ）」（国土交通省）を OSM に取り込んだもの。OSM への取り込みは2012年に国土交通省から「問題はありません」との回答を得ている（[OSM Wiki: Japan KSJ2 Import](https://wiki.openstreetmap.org/wiki/JA:Import/Catalogue/Japan_KSJ2_Import)）。その旨もアプリ内に併記している。

外部サービスへの配慮:

- Overpass API（データ作成時のみ）: 1本ずつ・3秒間隔・識別できる User-Agent で問い合わせる。混雑でタイムアウトしたら範囲を分割して取り直す
- 地理院の逆ジオコーダ: 地区名は川の区間（合流から次の合流まで）ごとに1つだけ引く（大字が返るまで最大3地点）。同時4件に絞り、別の地点が選ばれたら未送信の問い合わせは取りやめる（`config.ts` の `GEOCODER`）
- 地理院タイル: ブラウザのキャッシュに任せる。重ね描きは必要な範囲だけ画像にする
- e-Stat（データ作成時のみ）: ファイルを1本ずつ、1秒間隔で取得する
- Open-Meteo: 流域サマリを開いたときだけ1回問い合わせ、同じ地点は覚えておく（無料の API は非商用・1日1万回まで）

データの利用に問題があれば info@yokinist.me までご連絡ください。
