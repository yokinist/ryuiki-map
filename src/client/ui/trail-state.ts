// 「今どちらの道のりを見ているか」から決まる表示（DOM・地図に触らない純粋な決まり。ui/rain.ts が使う）

/** パネルの2つの道のり（雨の通り道・水の来た道） */
export type Trail = "route" | "source";

/** 見ている道のりに合わせた、ボタンの出し分け・消す線・共有 URL の dir */
export function trailView(kind: Trail) {
  return {
    /** 「上流へさかのぼる」「下流へくだる」は、今見ていない方だけ出す */
    showUp: kind === "route",
    showDown: kind === "source",
    /** 別の道のりの線は、ここでは伸びていかないので消す */
    clearLine: kind === "route" ? "upstream" : "downstream",
    /** 共有 URL の dir。水の来た道なら up（開くとすぐにさかのぼる） */
    dir: kind === "source" ? "up" : null,
  } as const;
}
