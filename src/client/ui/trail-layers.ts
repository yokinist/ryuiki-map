// 地図に重ねる道のり（雨粒の印・伸びていく線・合流点やダムの印・集水域の塗り）。雨の通り道・水の来た道で共通
import maplibregl, { type Map as MlMap } from "maplibre-gl";
import type { LngLat } from "../geo";
import { maskRect, paint, setData, setImage } from "../map/overlays";
import { pixel } from "../map/theme";
import type { Grid } from "../terrain/grid";
import { upstream } from "../terrain/hydro";
import { el } from "./dom";
import type { SurveyDot } from "./survey-dots";
import type { TimelineEvent } from "./timeline";

type Line = "downstream" | "upstream";

export class TrailLayers {
  private readonly drop = new maplibregl.Marker({
    element: el("div", { className: "drop", ariaHidden: "true" }), // 地図上の飾り。内容はパネルが伝える
  });

  private readonly popup = new maplibregl.Popup({
    closeButton: false,
    maxWidth: "240px",
  });

  constructor(private readonly map: MlMap) {
    // 地図の調査地点を押すと、場所と結果を出す
    map.on("click", "survey", (e) => {
      const f = e.features?.[0];
      if (f?.geometry.type !== "Point") return;
      this.popup
        .setLngLat(f.geometry.coordinates as LngLat)
        .setText(String(f.properties.text))
        .addTo(map);
    });
  }

  /** 環境省の測定点・市民の調査地点を地図に点で置く。時系列の帯で押した点（on）だけ目立たせる */
  showSurvey(dots: SurveyDot[], pts: LngLat[], on?: SurveyDot) {
    setData(this.map, "survey", {
      type: "FeatureCollection",
      features: dots.map((d) => ({
        type: "Feature",
        properties: {
          kind: d.kind,
          tone: d.tone,
          text: d.text,
          on: d === on,
        },
        geometry: { type: "Point", coordinates: pts[d.step] },
      })),
    });
  }

  /** 雨粒の印を p に置く */
  placeDrop(p: LngLat) {
    this.drop.setLngLat(p).addTo(this.map);
  }

  removeDrop() {
    this.drop.remove();
  }

  /** 線・印・塗りを全部消す（雨粒の印は残す） */
  clear() {
    setImage(this.map, "basin");
    setData(this.map, "downstream");
    setData(this.map, "upstream");
    setData(this.map, "confluences");
    setData(this.map, "survey");
    this.popup.remove();
  }

  /** 流れの先読み（カーソルの下の流れ）を消す */
  clearHover() {
    setData(this.map, "hover");
  }

  /** 道のりの線を1本消す */
  clearLine(line: Line) {
    setData(this.map, line);
  }

  /** 雨粒の印を k 番目の点へ動かし、道のりの線をそこまで伸ばす */
  advance(line: Line, pts: LngLat[], k: number) {
    this.drop.setLngLat(pts[k]);
    setData(this.map, line, {
      type: "LineString",
      coordinates: pts.slice(0, k + 1),
    });
  }

  /**
   * 時系列に出た項目のうち、川の合流・支流の合流・ダムを地図にも印と名前で置く。
   * 出発点自体（最初の川。id "r0"）は雨粒の印と重なるので出さない。ダムは「を通る」を除いた名前だけ
   */
  showConfluences(events: TimelineEvent[], pts: LngLat[]) {
    const marks = events.filter(
      (ev) =>
        (ev.kind === "river" && ev.id !== "r0") ||
        ev.kind === "dam" ||
        ev.kind === "branch",
    );
    setData(this.map, "confluences", {
      type: "FeatureCollection",
      features: marks.map((ev) => ({
        type: "Feature",
        properties: {
          kind: ev.kind,
          label: ev.kind === "dam" ? ev.title.replace(/を通る$/, "") : ev.title,
        },
        geometry: { type: "Point", coordinates: pts[ev.step] },
      })),
    });
  }

  /** クリック地点の集水域を地図に塗る（数値は流域サマリで見る） */
  showBasin(
    g: Grid,
    s: number,
    alive: () => boolean,
    up = upstream(g.down, g.order, s),
  ) {
    const fill = pixel("--color-basin", 0xa8);
    const rect = maskRect(g, up);
    if (rect)
      paint(g, (c) => (up[c] ? fill : 0), rect).then((img) => {
        if (alive()) setImage(this.map, "basin", img, { fade: true });
        else URL.revokeObjectURL(img.url);
      });
  }
}
