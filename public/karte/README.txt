このフォルダのデータは、流域探索マップ（地図アプリ）の「流域サマリ」のためのものです。
ライセンスの違うデータを混ぜないよう、版（latest.json が指すフォルダ）の中で置き場を分けています。

meshes/  人口と土地の使われ方（1kmメッシュ単位）。出典とライセンスは meshes/README.txt
dams/    ダム・堰の位置と名前（OpenStreetMap 由来、ODbL）。出典とライセンスは dams/README.txt
index.json  ファイルがある1次メッシュの一覧 { meshes: [...], dams: [...] }
