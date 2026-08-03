# 埼玉県 湧水ポテンシャルマップ（MVP）

MapLibre GL JS を使った、埼玉県の既知湧水地点・湧水ポテンシャルスコア・週別降水量を
重ね合わせて可視化する静的Webアプリです。ビルドステップ不要（フレームワーク不使用の
Vanilla JS + CDNライブラリのみ）で、GitHub Pages にそのまま公開できます。

初期表示範囲は埼玉県秩父地域・横瀬町周辺（緯度35.98, 経度139.10）です。

**現在の状態:**
- **既知湧水地点（springs.geojson）は実データです。** 環境省「湧水保全ポータルサイト」の
  [埼玉県の代表的な湧水](https://www.env.go.jp/water/yusui/result/sub2/saitama.html)
  に掲載されている101地点を [scripts/geocode_springs.js](scripts/geocode_springs.js) で
  取得・ジオコーディングしたものです。出典データに緯度経度が無いため、住所から座標を
  推定している点に注意してください（詳細は [data/README.md](data/README.md) 参照）。
- **1997年湿地湧水地台帳（wetland_1997.geojson）も実データです。** 埼玉県環境科学国際センター
  「Atlas Eco Saitama」が公開する
  [1997年版 埼玉県湿地湧水地台帳](https://atlas-eco-saitama-pref-saitama.hub.arcgis.com/apps/50e96c8bc0cf4bd29418301d7640b33d/explore)
  （ArcGIS FeatureServer）から894地点を [scripts/fetch_wetland_1997.js](scripts/fetch_wetland_1997.js)
  で取得したもの。1997年時点のスナップショットで、現況とは異なる場合がある点に注意してください。
- **湧水ポテンシャルスコア・週別降水量はダミーデータです。** 実データへの差し替え手順は
  本ファイル下部を参照してください。
- **現地調査記録（field_survey.geojson）は、あなたがこのアプリを使って記録していくデータです。**
  上記の実データ（springs.geojson / wetland_1997.geojson）は書き換えず、現地で確認した
  位置・現況を別レイヤーとして重ねて記録できます。使い方は
  [「現地調査記録機能の使い方」](#現地調査記録機能の使い方)を参照してください。

## 画面構成

- **左パネル**: レイヤーコントロール（表示ON/OFF・不透明度・閾値スライダー）
  1. 既知湧水地点（環境省データ、実データ）
  2. 1997年湿地湧水地台帳（歴史データ、実データ。カテゴリ別5色、「湧水・井戸」のみ絞り込み可）
  3. 湧水ポテンシャルスコア（青の連続配色ヒートマップ、スコア閾値で絞り込み可、ダミーデータ）
  4. 背景地形（陰影段彩図・傾斜量図、国土地理院タイル）
  5. 週別降水量（オレンジの連続配色、週スライダー＋再生ボタンでアニメーション、ダミーデータ）
  6. 現地調査記録（✓確認済み/！要再訪のバッジ。あなたが記録するデータ、詳細は下記）
- **地図**: 湧水地点・1997年湿地台帳・現地調査記録の各地点クリックでポップアップ、
  ポテンシャルグリッドクリックで右パネルにスコア内訳（TWI・HAND・地質境界距離・曲率・湧水KDE）を表示
- **右パネル**: クリックしたグリッドセルのスコア内訳
- **下部パネル**: タブ切り替え式のテーブルビュー（湧水地点 / ポテンシャルグリッド / 1997年湿地台帳 /
  現地調査記録）。ソート可能、CSVダウンロード・GeoJSONダウンロード
  （現在の地図表示範囲×フィルタ条件で絞り込み。ただし現地調査記録タブは常に全件を出力）

## ローカルで動かす

MapLibreのソース読み込みやESモジュール（`<script type="module">`）は `file://` で直接
開くとブラウザのセキュリティ制限で動作しないため、簡易HTTPサーバー経由で開いてください。

```bash
# このディレクトリ（web/）で実行
python -m http.server 8000
# または
npx serve .
```

ブラウザで `http://localhost:8000` を開きます。

外部通信は以下のみです（すべて表示用の公開タイル・CDNで、APIキー等は不要）。

- CDN: MapLibre GL JS（`unpkg.com`）
- 地図タイル: 国土地理院タイル（`cyberjapandata.gsi.go.jp`。標準地図・陰影段彩図・傾斜量図）

## GitHub Pages で公開する

1. このリポジトリ（またはこの `web/` ディレクトリを切り出した別リポジトリ）を GitHub にpush
2. リポジトリの Settings → Pages で、公開ソースとして `web/` を含むブランチ/ディレクトリを指定
   - `web/` を独立リポジトリのルートにする場合は `index.html` がそのままルートに来るので追加設定不要
   - モノレポのままこのパスを公開したい場合は GitHub Actions で `web/` を成果物として
     `actions/upload-pages-artifact` に渡すワークフローを追加してください
3. 公開URLにアクセスして動作確認

## 現地調査記録機能の使い方

既知湧水地点・1997年湿地台帳のデータは**書き換えず**、現地で確認した最新の位置・現況を
別レイヤー（`data/field_survey.geojson`）として重ねて記録できる機能です。

### 記録の流れ

1. **記録する**（現地・オフラインでもOK）
   - 既存地点の場合: 地図上のピンをクリック→ポップアップ内の「📝 現地調査を記録」ボタン
   - データに無い新規発見地点の場合: 左パネルの「現地調査記録」→「＋ 現地調査を記録（新規地点）」
   - フォームで現況・確認日・位置（GPS取得ボタンあり）・メモ等を入力して「下書きに保存」
   - 保存内容は**サーバーに送信されず、その端末のブラウザ内に「下書き」として残ります**
     （通信不要。電波の無い場所でも記録できます）
2. **地図で確認する**
   - 保存した記録は緑（✓確認済み）またはオレンジ（！要再訪）のバッジとして即座に地図に反映されます
   - 下部パネルの「現地調査記録」タブでも一覧確認できます
3. **持ち帰ってエクスポートする**
   - 「現地調査記録」タブを開き、「GeoJSONダウンロード」をクリック
   - これまでの下書き全件（＋既にリポジトリにある確定分）を1つにまとめた
     `field_survey.geojson` がダウンロードされます
4. **リポジトリに反映する**
   - ダウンロードしたファイルで `data/field_survey.geojson` を上書きし、commit・push
   - GitHub Pagesに反映されたら、左パネルの「🗑 下書きを全て消去」でこの端末の下書きを消してOKです
     （消さなくても支障はありませんが、再エクスポート時に重複扱いされないよう整理する運用を推奨）

### 注意点

- **下書きは端末（ブラウザ）ごとに保存されます。** 別のスマホ・PCで記録した下書きは
  自動では同期されません。それぞれの端末でエクスポート→commitする必要があります。
- 1つの地点を複数回訪れた場合も上書きせず、訪問ごとに別レコードとして残ります
  （現況の変化を後から振り返れるようにするためです）。
- 写真は画像ファイル自体を保存する仕組みは無く、URL（Google Photos等の共有リンク）を
  貼り付ける運用です。

## 実データへの差し替え・更新

### 1. 既知湧水地点（springs.geojson）

**環境省データを再取得する場合**（既に実データが入っています。ページが更新された場合の再生成用）:

```bash
cd scripts
node geocode_springs.js   # 依存パッケージ不要（Node.js 18+）
```

環境省ページの表をスクレイピングし、各所在地を国土地理院「住所検索API」でジオコーディングして
`../data/springs.geojson` を上書き生成します。詳細は
[scripts/geocode_springs.js](scripts/geocode_springs.js) 冒頭のコメントを参照してください。

**自前のCSVから作る場合**は、CSVを用意し（列: `name, lat, lng, source, confirmed_year, status,
accuracy`）、以下の変換スクリプトを実行します（この場合は緯度経度をあらかじめCSV側で用意する
必要があります）。

```bash
cd scripts
python csv_to_geojson.py 湧水データ.csv -o ../data/springs.geojson
```

詳細な列の意味は [scripts/csv_to_geojson.py](scripts/csv_to_geojson.py) 冒頭のコメント、
出力形式は [data/README.md](data/README.md) を参照してください。

### 2. 1997年湿地湧水地台帳（wetland_1997.geojson）

出典ページ（Atlas Eco Saitama）が更新された場合の再取得用:

```bash
cd scripts
node fetch_wetland_1997.js   # 依存パッケージ不要（Node.js 18+）
```

ArcGIS FeatureServerに直接クエリして `../data/wetland_1997.geojson` を上書き生成します。
名称からのカテゴリ推定ロジック（`classify()`）は
[scripts/fetch_wetland_1997.js](scripts/fetch_wetland_1997.js) を参照・編集してください。

### 3. 湧水ポテンシャルスコア（potential_grid.geojson）

[scripts/compute_potential.py](scripts/compute_potential.py) が算出パイプラインの雛形です。
現状は各指標の計算関数が `NotImplementedError` の骨組みのみなので、以下を用意したうえで実装してください。

- DEM10m（国土地理院 基盤地図情報数値標高モデル）
- TWI/HAND（環境省EADAS 全国30mメッシュ、または自前計算）
- 地質境界ベクター（産業技術総合研究所「地質図Navi」）
- `data/springs.geojson`（クロスバリデーション用の既知湧水地点）

重み付けは `compute_potential.py` 内の `Weights` データクラスで一元管理しています。
正規化方式（min-max）や出力プロパティ（`score, twi, hand, dist_to_boundary, curvature,
spring_kde`）もコメントに明記してあるので、そちらを参照しながら実装してください。

### 4. 週別降水量（rainfall_weekly.json）

気象庁の解析雨量・メッシュ平年値等から、地域（市町村 or 降水量メッシュ）単位で
週合算したデータを [data/README.md](data/README.md) 記載のJSON形式で用意し、
`data/rainfall_weekly.json` を差し替えてください（変換スクリプトは未提供のため、
データ提供時に別途 `scripts/` へ追加する想定です）。

## ファイル構成

```
web/
├── index.html
├── css/style.css
├── js/
│   ├── main.js         地図初期化・状態管理・UI配線（エントリーポイント）
│   ├── layers.js        各レイヤーの追加・表示切替・配色ロジック
│   ├── table.js         テーブル表示・ソート
│   ├── export.js        CSV/GeoJSONダウンロード
│   └── fieldSurvey.js    現地調査記録の下書き（localStorage）管理・マージ処理
├── data/
│   ├── springs.geojson
│   ├── wetland_1997.geojson
│   ├── potential_grid.geojson
│   ├── rainfall_weekly.json
│   ├── field_survey.geojson
│   └── README.md    各データの形式・出典
└── scripts/
    ├── geocode_springs.js     環境省データの取得・ジオコーディング（springs.geojson生成、実装済み）
    ├── fetch_wetland_1997.js  1997年湿地台帳の取得（wetland_1997.geojson生成、実装済み）
    ├── csv_to_geojson.py      自前CSVからの変換（緯度経度が既知の場合）
    └── compute_potential.py   湧水ポテンシャルスコア算出パイプラインの雛形
```
