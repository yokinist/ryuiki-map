// Overpass API への問い合わせ。利用ポリシーに沿って、1本ずつ・間隔をあけ・識別できる User-Agent を付ける。
// 混雑（429/504）のときは待つ時間を延ばして取り直す
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];
const USER_AGENT =
  "ryuiki-map/0.1 (personal non-commercial map; https://github.com/yokinist)";
/** 問い合わせの間にあける時間 */
const PAUSE_MS = 3000;
/** 混雑時の待ち時間。この順に待って取り直す */
const BACKOFF_MS = [15_000, 30_000, 60_000, 120_000];

export const sleep = (ms = PAUSE_MS) => new Promise((r) => setTimeout(r, ms));

export async function overpass<T>(query: string): Promise<T[]> {
  let last = "";
  for (const wait of [0, ...BACKOFF_MS]) {
    if (wait) {
      console.log(`  busy (${last}), retry in ${wait / 1000}s`);
      await sleep(wait);
    }
    for (const url of ENDPOINTS) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "User-Agent": USER_AGENT },
        body: query,
        // 混雑時は応答しないまま接続が残ることがある。問い合わせの timeout（180秒）より少し長く待って打ち切る
        signal: AbortSignal.timeout(200_000),
      }).catch((e: Error) => ({ ok: false, status: e.message }) as const);
      if (res.ok && "json" in res) {
        // 時間切れやメモリ不足でも HTTP 200 で途中までの結果が返り、remark にエラーが書かれる。途中の結果は使わない
        const body: { elements: T[]; remark?: string } = await res
          .json()
          .catch(() => ({ elements: [], remark: "error: not json" }));
        if (!body.remark?.includes("error")) return body.elements;
        last = body.remark;
        continue;
      }
      last = String(res.status);
    }
  }
  throw new Error(`overpass: ${last}`);
}
