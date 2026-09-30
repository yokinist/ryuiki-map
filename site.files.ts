// ビルド時に dist へ書き出す、サイトの URL を含むファイル（開発サーバーでも同じものを返す）。
// Worker で返すと bot のアクセスが Worker の実行回数（無料枠）を食うので、静的アセットにしている
import { SITE } from "./site.config.ts";

const robots = `User-agent: *
Allow: /

Sitemap: ${SITE.url}sitemap.xml
`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE.url}</loc></url>
</urlset>
`;

// AI（LLM）向けのサイト説明。https://llmstxt.org/ の形式。
// 「利用上の注意」「出典・ライセンス」は index.html の同じ見出しと内容を揃える
const llms = `# ${SITE.name}${SITE.stage}

> 日本のどこかに降った雨が、どの川と集落（大字）を通って、どの海へたどり着くかを地図上で再生する Web アプリ。流れの向きは国土地理院の標高タイルから推定し、川の名前は OpenStreetMap、地区名は地理院の逆ジオコーダから引く。無料・登録不要。個人が非商用で開発しているオープンソース（MIT License）。

Ryuiki Tansaku Map ("ryuiki" means watershed / drainage basin, "tansaku" means exploration): click anywhere in Japan to follow where the rain that falls there flows — through which rivers and villages, and into which sea. Flow directions are estimated from GSI elevation tiles; river names come from OpenStreetMap.

## できること

- 日本全国の陸地の地点をクリック（キーボードでは地図を選んで Enter）すると、そこに降った雨粒が河口まで流れる様子を再生する
- 流路沿いに、合流する川・通過するダムと堰・通過する地区（大字）・流れ込む海（太平洋・日本海・瀬戸内海・東シナ海・オホーツク海）を時系列で表示する
- 河口までの距離と、流速 1m/s と仮定した到着までの目安時間を表示する
- クリックした地点より上流で雨を集める範囲（集水域）を地図に塗る（面積・川などの数値は流域サマリ）
- 「上流へさかのぼる」で、クリックした地点の水がどこから来たかを、支流の先の先までたどっていちばん遠い水源までさかのぼり、通る川・流れ込む主な支流・地区を上流への距離と何時間前の雨かを添えて並べる
- 「流域サマリ」で、海までの距離と通り道の土地、上流の集水域（面積・標高・人口の推移2010〜2020年・年間降水量・ダムと堰・川）を1枚にまとめる
- 地点付きの URL で共有できる: \`${SITE.url}?p=経度,緯度\`（例: ${SITE.url}?p=139.1,35.8）。\`&dir=up\` を付けると、その地点から水源へさかのぼるところを再生する

## 利用上の注意

- 試作段階のアプリ。データや計算に誤りが含まれている可能性がある
- 流れの向きは標高タイル（約10〜240mメッシュ）から計算した推定。平地・市街地・用水路のある場所では実際と異なることがある
- 川の名前と河川線は OpenStreetMap のもの。日本の河川線の多くは国土数値情報（河川データ）2006年度版を取り込んだもので、その後の改修や名称の変更は反映されていないことがある
- 地区名は地理院の逆ジオコーダによる大字単位の目安
- 海の名前は国際水路機関（IHO）の海域区分による。関東以西の太平洋側（IHO の区分ではフィリピン海）も太平洋と表示する
- 所要時間は流速 1m/s と仮定したおおよその目安
- 流域サマリの人口は1kmメッシュの人口を面積で按分した推定、土地の使われ方は衛星画像の分類（約70mに縮小して集計）、年間降水量は範囲の中心1地点の再解析値で、どれも目安。ダム・堰は OpenStreetMap に登録されているものだけを数える
- アクセス数の把握に Cloudflare Web Analytics を使う。クッキーは使わず、個人を特定しない範囲（地図・雨の通り道・水の来た道の画面ごとの表示数、参照元・国・表示速度）だけを集計する。クリックした地点は送らない
- 防災・測量・ナビゲーションなど、正確さが求められる用途には使えない

## 出典・ライセンス

ソースコードは [MIT License](${SITE.repo}/blob/main/LICENSE)。地図データは MIT ではなく、出典ごとに次のライセンス（${SITE.repo}/blob/main/NOTICE.md）。

- [地理院タイル](https://maps.gsi.go.jp/development/ichiran.html)（白地図・淡色地図・陰影起伏図・標高タイル）、地理院 逆ジオコーダ（国土地理院）
- 河川線と名前: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright)（ODbL 1.0）。変換した河川タイルも ODbL で提供: ${SITE.url}rivers/README.txt 。日本の河川線の多くは国土数値情報（河川データ、国土交通省）を2012年に同省の了承を得て OpenStreetMap に取り込んだもの。国土数値情報の河川データは現在「非商用」の条件で提供されており、このアプリも非商用で利用している
- 海域: Flanders Marine Institute (2018). IHO Sea Areas, version 3（[Marine Regions](https://www.marineregions.org/)、CC BY 4.0）
- 流域サマリの人口: 「国勢調査」2010・2015・2020年 1kmメッシュ（総務省統計局、[e-Stat](https://www.e-stat.go.jp/gis)）を加工して作成
- 流域サマリの土地の使われ方: © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium（CC BY 4.0）
- 流域サマリの年間降水量: [Weather data by Open-Meteo.com](https://open-meteo.com/)（CC BY 4.0、ERA5）
- ダム・堰（流域サマリ・雨の通り道）: © OpenStreetMap contributors（ODbL 1.0）。流域サマリのデータも配信: ${SITE.url}karte/README.txt

## リンク

- [${SITE.name}${SITE.stage}](${SITE.url}): アプリ本体
- [ソースコード](${SITE.repo}): 計算のしくみは README の「しくみ」
- [不具合の報告・提案](${SITE.repo}/issues)
`;

/** 配信するパス → [Content-Type, 中身] */
export const SITE_FILES: Record<string, [type: string, body: string]> = {
  "/robots.txt": ["text/plain; charset=utf-8", robots],
  "/sitemap.xml": ["application/xml; charset=utf-8", sitemap],
  "/llms.txt": ["text/plain; charset=utf-8", llms],
};
