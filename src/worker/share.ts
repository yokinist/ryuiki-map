// 共有した結果のプレビュー。共有ボタンを押したときにブラウザが預ける「画面に出ている結論」を確かめ、
// クローラー向けのタイトル・説明に組み立てる（Worker ランタイムに依存しない純粋な部分）

/** 預かる結論。どれも共有 URL と画面に出ている文字だけで、利用者を特定する情報は入れない */
export interface ShareEntry {
  /** 共有 URL の ?p=（経度,緯度。小数5桁） */
  p: string;
  /** 共有 URL の dir。水の来た道なら "up" */
  dir: "up" | null;
  /** 出発点の地名 */
  origin: string;
  /** 見出し（「瀬戸内海にたどり着きました」など） */
  headline: string;
  /** 距離と時間（「9.9 km・約3時間」「95.5 km上流・約27時間前」） */
  distance: string;
  /** 河口の地名。なければ null */
  where: string | null;
}

const P = /^-?\d{1,3}\.\d{5},-?\d{1,2}\.\d{5}$/;
// 見出しは journey-panel.ts の conclude に渡す文言だけを受け付ける。よその文言をプレビューに出させないため
const HEADLINE =
  /^(?:(?:太平洋|日本海|瀬戸内海|東シナ海|オホーツク海|海)にたどり着きました|河口まで追いきれませんでした|水源にたどり着きました|水源まで追いきれませんでした)$/;
const DISTANCE = /^[\d.,]+ k?m(?:上流)?・約[\d.]+(?:分|時間|日)(?:前)?$/;
// 地名は町丁・字までの日本語と、実際のデータにある記号（，、～－・全角の英数字と空白・ローマ数字・丸数字・川の名前の半角の括弧と英字と /）だけ。
// HTML や URL を混ぜられる <>"& と : . は通さない（HTMLRewriter も値をエスケープするが、プレビューに URL を出させない）
// ponytail: 形の合う地名なら、誰でも任意の地点のプレビューを書き換えられる。荒らされたら、地名を座標から Worker で引き直す
const PLACE =
  /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々〆ヶ0-9A-Za-z\uFF01-\uFF5E\u2160-\u217F\u2460-\u2473㈱/ \u3000（）()・、，～－-]{1,80}$/u;

const str = (v: unknown, re: RegExp) =>
  typeof v === "string" && re.test(v) ? v : undefined;

/** 預かった本文を確かめる。形が違えば null（捨てる） */
export function parseShare(body: unknown): ShareEntry | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const dir = b.dir === "up" ? "up" : b.dir == null ? null : undefined;
  const p = str(b.p, P);
  const origin = str(b.origin, PLACE);
  const headline = str(b.headline, HEADLINE);
  const distance = str(b.distance, DISTANCE);
  const where = b.where == null ? null : str(b.where, PLACE);
  if (
    dir === undefined ||
    !p ||
    !origin ||
    !headline ||
    !distance ||
    where === undefined ||
    // さかのぼり（up）の見出しは水源、下りの見出しは海・河口。食い違うと言い回しが崩れる
    (dir === "up") !== headline.startsWith("水源")
  )
    return null;
  return { p, dir, origin, headline, distance, where };
}

/** KV の鍵。同じ共有 URL（座標と向き）なら同じ鍵 */
export const shareKey = (p: string, dir: "up" | null) =>
  dir ? `${p}|${dir}` : p;

/** クローラーに返すタイトルと説明 */
export function previewMeta(
  e: ShareEntry,
  site: { name: string; stage: string },
): { title: string; description: string } {
  const title = `${e.headline}（${e.distance}）｜${site.name}${site.stage}`;
  const description = e.dir
    ? `${e.origin}から水の来た道をさかのぼり、${e.headline}。${e.distance}`
    : `${e.origin}に降った雨は、${e.where ? `${e.where}から` : ""}${e.headline}。${e.distance}`;
  return { title, description };
}

/** 共有時の画像を描くサービス（yokinist/og-image、MIT）。Noto Sans JP で、使う文字だけを読み込んで描く */
const OG_IMAGE = "https://simple-og-image.vercel.app";
// scripts/build-og.ts と同じく tokens.css の --color-drop（雨粒の色）。Worker は CSS を読めないので写す
const DROP = "#d6336c";

/**
 * 共有時の画像（og-image の URL）と、その代わりの文章。大きな字は結論を短く（「瀬戸内海まで 9.9 km」）し、
 * 長い見出しで語の途中に折り返さないようにする。小さな字は出発点の市区町村・河口・時間
 */
export function previewImage(
  e: ShareEntry,
  site: { name: string; stage: string; themeColor: string },
): { url: string; alt: string } {
  const [length, time] = e.distance.split("・");
  const km = length.replace(/上流$/, "");
  const to = e.headline.match(/^(.+)にたどり着きました$/)?.[1];
  const title = to ? `${to}まで ${km}` : e.headline;
  // 出発点は町丁・字の前（市区町村まで）、河口は括弧の地名の前（「淀川河口」）
  const city = e.origin.split(" ")[0];
  const mouth = e.where?.replace(/（[^（）]*）$/, "");
  const lead = e.dir
    ? `${city}の水の来た道`
    : `${city}に降った雨${mouth ? `は、${mouth}から` : ""}`;
  const description = `${lead}・${time}`;
  const q = new URLSearchParams({
    siteTitle: `${site.name}${site.stage}`,
    description,
    background: site.themeColor,
    accent: DROP,
  });
  return {
    url: `${OG_IMAGE}/${encodeURIComponent(title)}.png?${q}`,
    alt: `${title}。${description}`,
  };
}
