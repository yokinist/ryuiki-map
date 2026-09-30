// index.html の {{キー}} に、ビルド時（開発サーバーでも）差し込まれる。
// site.files.ts の robots.txt・sitemap.xml・llms.txt もここの値を使う
const url = "https://ryuiki-map.ykns.workers.dev/";

export const SITE = {
  name: "流域探索マップ",
  // 公開の段階。名前の後ろに続ける（タブ名・共有タイトルは name + stage）。画面の見出しと共有時の画像（pnpm build:og）では小さく薄く出す。要らなければ空文字
  stage: "(β)",
  description: "降った雨の行き先をたどれる探索マップ",
  url,
  repo: "https://github.com/yokinist/ryuiki-map",
  themeColor: "#12343b",
  // public/og.png（1200×630）。差し替えるときは index.html の og:image:width / height も合わせる
  // 画像の文字（name・stage・ogTagline）を変えたら `pnpm build:og` で描き直す
  ogImage: `${url}og.png`,
  ogTagline: "ここに降った雨は、どこの海へ？",
  ogImageAlt: "流域探索マップのタイトルと、格子上に淡く描かれた関東の河川網",
  // Cloudflare Web Analytics のトークン（公開されてよい値）。空なら計測タグを出さない
  analyticsToken: "89fcd3d179304341ad7c324643c9436b",
};

/** 検索エンジンや AI が読む構造化データ（schema.org）。index.html の <head> に JSON-LD で入る */
export const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@type": "WebApplication",
  name: `${SITE.name}${SITE.stage}`,
  url: SITE.url,
  description:
    "日本のどこかに降った雨が、どの川と集落を通ってどの海へたどり着くかを、標高データから推定して地図上で再生するWebアプリ。試作段階で、データや計算に誤りが含まれている可能性がある",
  image: SITE.ogImage,
  inLanguage: "ja",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Web",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: 0, priceCurrency: "JPY" },
  spatialCoverage: { "@type": "Country", name: "日本" },
  author: {
    "@type": "Person",
    name: "yokinist",
    url: "https://github.com/yokinist",
  },
  sameAs: [SITE.repo],
  isBasedOn: [
    {
      "@type": "Dataset",
      name: "地理院タイル（標高タイル・白地図・淡色地図・陰影起伏図）",
      url: "https://maps.gsi.go.jp/development/ichiran.html",
    },
    {
      "@type": "Dataset",
      name: "OpenStreetMap（河川線と名前）",
      url: "https://www.openstreetmap.org/copyright",
    },
    {
      "@type": "Dataset",
      name: "IHO Sea Areas, version 3（Marine Regions）",
      url: "https://www.marineregions.org/",
    },
    {
      "@type": "Dataset",
      name: "国勢調査 1kmメッシュ（e-Stat）",
      url: "https://www.e-stat.go.jp/gis",
    },
    {
      "@type": "Dataset",
      name: "ESA WorldCover 2021",
      url: "https://esa-worldcover.org/",
    },
    {
      "@type": "Dataset",
      name: "Open-Meteo Historical Weather API（ERA5）",
      url: "https://open-meteo.com/",
    },
  ],
};
