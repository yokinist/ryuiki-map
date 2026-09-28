流域探索マップの「流域サマリ」のために、OpenStreetMap から取り出したダム・堰のデータです。

出典: © OpenStreetMap contributors https://www.openstreetmap.org/copyright
ライセンス: Open Database License (ODbL) 1.0 https://opendatacommons.org/licenses/odbl/1-0/
  このデータ（OSM から作った派生データベース）も ODbL で提供します。再利用する場合は同じく ODbL に従ってください。
加工内容: waterway=dam / weir を Overpass API で取得し、位置（線・面は中心点）を1/10000度に丸め、名前とともに1次メッシュごとに分けました。

形式: 1次メッシュ番号.json = [[経度, 緯度, 0=ダム 1=堰, 名前（なければ空）], ...]
