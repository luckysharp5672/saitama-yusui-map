# data/ ディレクトリについて

フロントエンドが `fetch()` で直接読み込む静的データ一式です。`springs.geojson`・
`wetland_1997.geojson`・`potential_grid.geojson`・`geology_boundary.geojson`・
`field_survey.geojson` は実データ、`rainfall_weekly.json` のみダミーデータ（簡略化した
架空の値）です。`rainfall_weekly.json` の実データへの差し替え方法は
[../README.md](../README.md) の「実データへの差し替え」を参照してください。

## springs.geojson — 既知湧水地点（実データ）

**このファイルのみ実データです。** 環境省「湧水保全ポータルサイト」の
[埼玉県の代表的な湧水](https://www.env.go.jp/water/yusui/result/sub2/saitama.html)
に掲載されている101地点をもとに作成しています。Point Feature の配列。

| プロパティ | 内容 |
|---|---|
| `id` | 一意なID（`spring_001` 等） |
| `name` | 湧水地点の名称 |
| `kana` | ふりがな |
| `municipality` | 市区町村名 |
| `address` | 所在地（原文の住所表記。番地の記載が無いものもある） |
| `description` | 概要等（由来・伝説・湧出状況などの原文） |
| `access` | アクセス区分（`☆`可・目視触れる / `◎`可・目視近接 / `○`可・目視のみ / `×`不可 / `―`不明） |
| `conservation_activity` | 湧水保全活動の内容（記載が無い場合は空文字） |
| `status` | 現況。出典データに廃絶の記載が無いため一律 `湧出中` としている（季節的な渇水等の記述は `description` を参照） |
| `confirmed_year` | 現況確認年。出典データに記載が無いため常に `null` |
| `accuracy` | 座標精度（`正確` / `おおよそ`。下記「位置情報について」参照） |
| `source` | 出典 |
| `source_url` | 出典URL |
| `position_note` | 座標の推定方法・精度に関する注記（ポップアップにも表示） |

### 位置情報について（重要）

環境省の公表データには **緯度経度が含まれていません**（住所のみ）。そのため、
[web/scripts/geocode_springs.js](../scripts/geocode_springs.js) で
国土地理院「住所検索API」（`https://msearch.gsi.go.jp/address-search/AddressSearch`）を用いて
住所から座標を推定（ジオコーディング）しています。

- **`accuracy: "正確"`**（101件中51件）: 所在地に番地までの記載があり、その番地でジオコーディングできた地点。
  ただし建物・敷地の代表点であり、湧水そのものの位置とは数十m程度ずれる場合があります。
- **`accuracy: "おおよそ"`**（101件中50件）: 所在地が大字・地区名までの記載で番地が無いため、
  その地区の代表地点を表示しています。実際の湧水位置とは離れている可能性があります。
  地図上ではオレンジ色の枠線で表示され、ポップアップにも注記が表示されます。

**出典（実データ利用時）**: 埼玉県「電子版埼玉県湧水地マップ」、環境省「湧水保全ポータルサイト」等。
各データソースの利用規約・クレジット表記要件を確認のうえ使用してください。

## wetland_1997.geojson — 1997年 埼玉県湿地湧水地台帳（実データ・歴史データ）

**このファイルも実データです。** 埼玉県環境科学国際センター「Atlas Eco Saitama」が公開している
[1997年版 埼玉県湿地湧水地台帳](https://atlas-eco-saitama-pref-saitama.hub.arcgis.com/apps/50e96c8bc0cf4bd29418301d7640b33d/explore)
（1997年に埼玉県環境生活部自然環境課が作成した湿地・湧水地マップをデジタル化したもの）から、
背後のArcGIS FeatureServer（匿名クエリ可）を直接呼び出して取得した894地点。Point Feature の配列。
[web/scripts/fetch_wetland_1997.js](../scripts/fetch_wetland_1997.js) で生成。

| プロパティ | 内容 |
|---|---|
| `id` | 一意なID（`wetland1997_001` 等） |
| `name` | 名称（元データが空欄の場合は `(名称未記載)`） |
| `municipality` | 市区町村名（1997年当時の行政区画。合併前の旧市町村名を含む） |
| `address` | 所在地（記載が無い場合は `null`） |
| `category` | `湧水・井戸` / `池・沼` / `河川・水路` / `湿地・湿原` / `その他` の5分類 |
| `wetland_no` | 元データの湿地No |
| `raw_type_code` / `raw_naturalness_code` | 元データの「湿地種類」「湿地自然度」コード値（生値） |
| `status_note` | 消失・縮小等の記録（例: `削除（耕地調整のため）`）。記録が無ければ `null`（＝現存扱い） |
| `survey_method` | 調査方法（県民調査 / 市町村報告 / 航空写真 等） |
| `survey_year` | 常に `1997` |
| `source` / `source_url` | 出典・出典URL |
| `data_note` | 位置づけに関する注記（ポップアップにも表示） |

### 重要な注意点

- **1997年時点のスナップショットです。** 894地点中、明示的に消失・縮小が記録されているのは
  8件のみですが、それ以外の地点についても現況を保証するものではありません。
  「現況の湧水」を知りたい場合は `springs.geojson`（環境省の現行データ）を参照してください。
- **`category` はこのアプリ独自の推定分類です。** 元データの「湿地種類」（`raw_type_code`、
  0〜4の数値）には公式な凡例（コード値の意味）がArcGIS側で公開されていなかったため、
  代わりに `name`（名称）の文字列にキーワードマッチングを行って分類しています
  （例: 「湧水」「井戸」「滝」を含む → `湧水・井戸`）。厳密な分類ではない点に留意してください。
- 地図上では `category` で色分けし、`status_note` が入っている地点は赤い太枠で強調表示しています。

## field_survey.geojson — 現地調査記録（あなたが記録するデータ）

`springs.geojson` / `wetland_1997.geojson` の**元データは書き換えず**、現地で確認した
最新の位置・現況をこのファイルに追記していく運用です。1地点を複数回訪れた場合も
上書きせず、訪問ごとに別レコードとして残します（履歴として追える append-only 形式）。

通常は手で編集せず、アプリ内の「現地調査を記録」フォームで下書きをブラウザに保存し、
「現地調査記録」タブの GeoJSONダウンロードで書き出したファイルをこのパスに上書きします
（詳しい手順は [../README.md](../README.md#現地調査記録機能の使い方) 参照）。Point Feature の配列。

| プロパティ | 内容 |
|---|---|
| `id` | 一意なID（`fieldsurvey_<timestamp>_<乱数>`） |
| `target_dataset` | 対象データセット（`springs` / `wetland1997` / `new`＝データに無い新規発見地点） |
| `target_id` | ひも付け先の `springs.geojson`/`wetland_1997.geojson` の `id`（新規地点は `null`） |
| `target_name` | 表示用の地点名（新規地点は現地で付けた名称） |
| `status` | 現況（`湧出中` / `枯渇` / `不明` / `要再訪`） |
| `surveyed_at` | 確認日（`YYYY-MM-DD`） |
| `surveyor` | 調査者（任意） |
| `address_note` | 所在地に関する現地メモ（任意） |
| `notes` | 備考（任意） |
| `photo_url` | 写真へのリンク（任意。画像ファイル自体は保存しない） |

初期状態は空の `FeatureCollection` です。

## geology_boundary.geojson — 地質境界線（実データ）

産業技術総合研究所「20万分の1日本シームレス地質図V2」の全国シェープファイルから、
対象エリア（横瀬町・秩父地域、バッファ込み）と交差する地質境界線・断層線だけを
[web/scripts/extract_geology_boundary.js](../scripts/extract_geology_boundary.js) で
切り出したもの。326件のMultiLineString Feature（境界線・断層線を区別せず一括で
「地質境界」として扱っている）。`potential_grid.geojson` の `dist_to_boundary` の
算出にのみ使用し、地図上には表示していない。

出典: 産業技術総合研究所 地質調査総合センター「20万分の1日本シームレス地質図V2」
（https://gbank.gsj.jp/seamless/ ）。政府標準利用規約(第2.0版)相当のライセンスで、
出典明記の上で商用利用・改変を含め二次利用可。

## potential_grid.geojson — 湧水ポテンシャルスコアグリッド（実データ・パイロットエリアのみ）

**横瀬町・秩父地域のパイロットエリア（既存のグリッド範囲、46×46=2,116セル、250m格子）に
限り実データです。** それ以外の地域は未算出（このアプリはこのエリアのみを表示対象にしている）。
[web/scripts/compute_potential.js](../scripts/compute_potential.js) で算出。
Polygon Feature（グリッドセル）の配列。

| プロパティ | 内容 |
|---|---|
| `cell_id` | グリッドセルの識別子 |
| `score` | 湧水ポテンシャルスコア（0-1、5指標の加重和） |
| `twi` | 地形湿潤指数（Topographic Wetness Index）。DEMから自前計算 |
| `hand` | HAND（Height Above Nearest Drainage, m）。DEMから自前計算 |
| `dist_to_boundary` | 最寄りの地質境界線までの距離（m）。`geology_boundary.geojson`から算出 |
| `curvature` | 曲率（ラプラシアン近似、遷急線・遷緩線＝傾斜変換点の指標）。DEMから自前計算 |
| `spring_kde` | 既知湧水地点(`springs.geojson`)のガウスカーネル密度（0-1に正規化済み） |

### 算出方法（重要）

このPCにPython実行環境が無かったため、`scripts/compute_potential.py`
（設計意図を示す雛形として残置）の代わりに **Node.js** で実装している。

1. **DEM取得**: [web/scripts/fetch_dem.js](../scripts/fetch_dem.js) が
   国土地理院DEM5A（5mメッシュ、精密標高基盤）タイルを対象エリア分取得・合成
   （出力は `scripts/raw/dem_grid.*`、重いため`.gitignore`対象）。
2. **地形指標計算**: [web/scripts/hydrology.js](../scripts/hydrology.js) が
   窪地埋め→Horn法による傾斜・曲率→D8法による流向・集水セル数（フローアキュムレーション）
   →TWI→水路抽出＋比高計算によるHAND、を実装（外部GISライブラリ非依存の自前実装）。
3. **250mグリッドへの集約**: 高解像度（約7.7m/px）のラスターを、出力グリッドの各セル
   範囲内で平均して集約。
4. **地質境界距離**: `geology_boundary.geojson` の全セグメントとの最短距離を
   セル中心ごとに計算（力任せ探索。セグメント数326・セル数2,116なので十分高速）。
5. **正規化・重み付け**: 各指標をmin-max正規化（HAND・地質境界距離は値が小さいほど
   湧水しやすいため反転）し、`compute_potential.py`と同じ重み
   （TWI 0.30 / HAND 0.30 / 曲率 0.15 / 地質境界 0.15 / 湧水KDE 0.10）で加重和。

**検証**: 対象エリア内の既知湧水地点（`springs.geojson`）12件の平均scoreは0.648で、
グリッド全体平均0.511より明確に高く、HANDもグリッド中央値35mに対し湧水地点中央値6mと
大きく低い（＝湧水地点は水路に近い低比高地に集中）。地形指標が物理的に妥当な傾向を
捉えていることを確認済み（ただし`spring_kde`自体が既知湧水地点から算出されるため、
この検証は独立した裏付けというよりは整合性チェックである点に留意）。

### 実データの再生成・他エリアへの拡張

```bash
cd scripts
node fetch_dem.js                  # DEM取得（対象エリアのbboxはfetch_dem.js内で指定）
node extract_geology_boundary.js   # 地質境界抽出（初回のみ約250MBのzipをダウンロード）
node compute_potential.js          # 上記2つの出力から potential_grid.geojson を生成
```

対象エリアを広げたい場合は、`fetch_dem.js`・`extract_geology_boundary.js`・
`compute_potential.js` それぞれの `BBOX` / `OUTPUT_GRID` 定数を変更してください
（DEMタイル数・計算量が面積に比例して増える点に注意）。

## rainfall_weekly.json — 週別降水量

```json
{
  "meta": { "description": "...", "unit": "mm", "weeks": ["2025-01-06", "2025-01-13", ...] },
  "regions": [
    {
      "code": "yokoze", "name": "横瀬町",
      "geometry": { "type": "Polygon", "coordinates": [...] },
      "weekly": [12.3, 8.1, ...]
    }
  ]
}
```

`meta.weeks[i]` と各 `regions[].weekly[i]` が対応します（週の開始日、月曜始まり想定）。
現在のダミー版は市町村単位の簡易矩形ポリゴン7地域 × 52週分です。

**出典（実データ利用時）**: 気象庁 解析雨量・メッシュ平年値等。地域区分は市町村単位、
または気象庁の降水量メッシュ単位に置き換えてください。実データ提供時は
`scripts/` 配下に変換スクリプトを追加してください（現状は未実装）。

## ライセンス・出典に関する注意

上記いずれの実データも、公開元の利用規約に従い出典表記・二次利用条件を遵守してください。
`rainfall_weekly.json`（ダミーデータ）は実在の観測値とは無関係の架空の値です。
