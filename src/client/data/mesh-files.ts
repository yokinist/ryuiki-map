// 1次メッシュ単位で配るデータの読み込み（水質 /water/・水生生物調査 /suisei/・全国一斉調査 /mizumap/ で共通）。
// <base>/latest.json が今の版を指し、<base>/<版>/index.json にファイルのあるメッシュ、<base>/<版>/<メッシュ番号>.json が中身
import type { LngLat } from "../geo";
import { meshOf } from "./karte-format";

/** base の1次メッシュのファイルを読む関数。ないメッシュ（海など）は空。読めなかったら失敗のまま返す */
export function meshFiles<T>(base: string): (m1: number) => Promise<T[]> {
  let index: Promise<{ url: string; has: Set<number> }> | null = null;
  const files = new Map<number, Promise<T[]>>();
  const loadIndex = () => {
    index ??= fetch(`${base}/latest.json`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      )
      .then(async ({ version }: { version: string }) => {
        const url = `${base}/${version}`;
        const i: { meshes: number[] } = await fetch(`${url}/index.json`).then(
          (r) => r.json(),
        );
        return { url, has: new Set(i.meshes) };
      })
      .catch((err) => {
        // 読めなかったときは覚えずに、次の呼び出しでまた取りに行く。空で解決すると、そのメッシュを「データなし」として
        // 覚えてしまい、流域サマリも失敗を「ない」と出すので、失敗のまま伝える
        index = null;
        throw err;
      });
    return index;
  };
  return (m1) => {
    let file = files.get(m1);
    if (!file) {
      file = loadIndex().then(async ({ url, has }) => {
        if (!has.has(m1)) return [];
        const res = await fetch(`${url}/${m1}.json`);
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      });
      file.catch(() => files.delete(m1)); // 失敗は覚えずに、次の呼び出しでまた取りに行く
      files.set(m1, file);
    }
    return file;
  };
}

/** 道のり pts が通る1次メッシュのファイルを全部読み、つなげて返す */
export async function rowsAlong<T>(
  file: (m1: number) => Promise<T[]>,
  pts: LngLat[],
): Promise<T[]> {
  const m1s = [...new Set(pts.map(([x, y]) => meshOf(x, y).m1))];
  return (await Promise.all(m1s.map(file))).flat();
}
