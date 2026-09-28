このフォルダのデータは、流域探索マップ（地図アプリ）の表示と流向計算のために OpenStreetMap から変換したものです。

出典: © OpenStreetMap contributors https://www.openstreetmap.org/copyright
ライセンス: Open Database License (ODbL) 1.0 https://opendatacommons.org/licenses/odbl/1-0/
  このデータ（OSM から作った派生データベース）も ODbL で提供します。再利用する場合は同じく ODbL に従ってください。
加工内容: waterway=river / stream のうち name があるものを Overpass API で取得し、線を約10mの許容誤差で間引き、
  座標を1/10000度の整数に丸め、川の総延長（km。waterway リレーション単位か、同じ名前でつながった線の合計の大きい方）を付けて0.5°四方のタイルに分割
形式: latest.json が版（フォルダ名）を指し、各タイルは { names: [川の名前...], rivers: [[名前の番号, 総延長km, x0, y0, dx1, dy1, ...], ...] }。
  座標は1/10000度の整数で、2点目以降は前の点との差分
備考: 日本の河川線の多くは「国土数値情報（河川データ）」（国土交通省）を OpenStreetMap に取り込んだものです。
  整備時点（2006年度前後）以降の河川改修や名称の変更は反映されていないことがあります。
  ナビゲーションや測量など高い精度が必要な用途には使えません。
