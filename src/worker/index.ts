// サイトの Worker。静的アセットはそのまま配り、run_worker_first（wrangler.jsonc）のパスだけここに来る
import { SITE } from "../../site.config.ts";
import {
  parseShare,
  previewImage,
  previewMeta,
  type ShareEntry,
  shareKey,
} from "./share";

/** 預かる本文の上限（バイト）。結論の文字だけなので、これを超えるものは捨てる */
const MAX_BODY = 2048;
/** 預かる期間（秒）。使われない鍵を残さない */
const TTL = 90 * 24 * 3600;

export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/share") return share(req, env);
    const res = await env.ASSETS.fetch(req);
    const p = url.searchParams.get("p");
    if (req.method !== "GET" || url.pathname !== "/" || !p) return res;
    if (!res.headers.get("content-type")?.includes("text/html")) return res;
    const dir = url.searchParams.get("dir") === "up" ? "up" : null;
    // 読めなければ（KV の障害・読み込みの上限など）共通のプレビューのまま、ページは今までどおり開く
    const entry = await env.SHARES.get<ShareEntry>(
      shareKey(p, dir),
      "json",
    ).catch(() => null);
    return entry ? preview(res, entry, url) : res;
  },
} satisfies ExportedHandler<Env>;

/** 共有ボタンを押したときに、画面に出ている結論を預かる */
async function share(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") return new Response(null, { status: 405 });
  if (Number(req.headers.get("content-length")) > MAX_BODY)
    return new Response(null, { status: 413 });
  const text = await req.text();
  // 日本語は1文字が3バイトなので、文字の数ではなくバイトで比べる
  if (new TextEncoder().encode(text).byteLength > MAX_BODY)
    return new Response(null, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  const entry = parseShare(body);
  if (!entry) return new Response(null, { status: 400 });
  // 同じ結果がもう預かってあれば書き込まない。KV の無料枠は書き込みが1日1,000回で、読み込み（10万回）より少ない。
  // 枠を使い切ると put が例外を投げて 500 になるが、ブラウザは失敗を無視して共有を続ける（プレビューが共通の見た目になるだけ）
  const key = shareKey(entry.p, entry.dir);
  const json = JSON.stringify(entry);
  if ((await env.SHARES.get(key)) !== json)
    await env.SHARES.put(key, json, { expirationTtl: TTL });
  return new Response(null, { status: 204 });
}

/** トップページのタイトル・説明・画像・URL を、共有した結果に差し替える（クローラー向けの見た目だけで、ページの動きは変えない） */
function preview(res: Response, entry: ShareEntry, url: URL): Response {
  const { title, description } = previewMeta(entry, SITE);
  const image = previewImage(entry, SITE);
  const content = (value: string) => ({
    element(e: Element) {
      e.setAttribute("content", value);
    },
  });
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(e) {
        e.setInnerContent(title);
      },
    })
    .on('meta[name="description"]', content(description))
    .on('meta[property="og:title"]', content(title))
    .on('meta[property="og:description"]', content(description))
    .on('meta[property="og:url"]', content(url.href))
    .on('meta[name="twitter:title"]', content(title))
    .on('meta[name="twitter:description"]', content(description))
    .on('meta[property="og:image"]', content(image.url))
    .on('meta[property="og:image:alt"]', content(image.alt))
    .on('meta[name="twitter:image"]', content(image.url))
    .on('meta[name="twitter:image:alt"]', content(image.alt))
    .transform(res);
  // 元の index.html の ETag のままだと、同じ鍵で共有し直して中身が変わっても 304 で古い HTML が使われるので外す
  const headers = new Headers(rewritten.headers);
  headers.delete("ETag");
  headers.set("Cache-Control", "no-cache");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}
