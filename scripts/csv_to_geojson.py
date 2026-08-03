"""
csv_to_geojson.py
既知湧水地点のCSVを springs.geojson（フロントエンドが読み込むデータ形式）に変換するスクリプト。

想定するCSVの列（列名はこの通りの英語ヘッダーにしてください）:
    name            湧水地点の名称（必須）
    lat             緯度（必須, 例: 35.981234）
    lng             経度（必須, 例: 139.101234）
    source          出典（例: 埼玉県電子版湧水地マップ）省略時は「不明」
    confirmed_year  現況を確認した年（例: 2023）省略可
    status          現況（湧出中 / 枯渇 / 不明）省略時は「不明」
    accuracy        座標精度（正確 / おおよそ）省略時は「おおよそ」

標準ライブラリのみで動作するため、事前の pip install は不要です（Python 3.8+を想定）。

使い方:
    cd web/scripts
    python csv_to_geojson.py 湧水データ.csv -o ../data/springs.geojson

Excelで作成したCSVを直接使う場合、文字コードが Shift-JIS(cp932) のことが多いので
    python csv_to_geojson.py 湧水データ.csv --encoding cp932
のように指定してください。
"""

import argparse
import csv
import json
from pathlib import Path

REQUIRED_FIELDS = ["name", "lat", "lng"]
# 省略可能な列と、CSVに値が無い場合のデフォルト値
OPTIONAL_FIELDS = {
    "source": "不明",
    "confirmed_year": None,
    "status": "不明",
    "accuracy": "おおよそ",
}


def parse_args():
    parser = argparse.ArgumentParser(description="湧水地点CSVをGeoJSON(springs.geojson)に変換する")
    parser.add_argument("input_csv", type=Path, help="入力CSVファイルパス")
    parser.add_argument(
        "-o", "--output", type=Path, default=Path("../data/springs.geojson"),
        help="出力先GeoJSONパス（既定: ../data/springs.geojson）"
    )
    parser.add_argument(
        "--encoding", default="utf-8-sig",
        help="CSVの文字コード。Excel由来のCSVで文字化けする場合は cp932 を試してください"
    )
    return parser.parse_args()


def row_to_feature(row, index):
    """CSVの1行（dict）をGeoJSON Featureに変換する。値の不備はここで検出しエラーにする。"""
    for field in REQUIRED_FIELDS:
        if not (row.get(field) or "").strip():
            raise ValueError(f"{index}行目: 必須列 '{field}' が空です")

    lat = float(row["lat"])
    lng = float(row["lng"])
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError(f"{index}行目: 座標が範囲外です lat={lat}, lng={lng}")

    properties = {"id": f"spring_{index:03d}", "name": row["name"].strip()}
    for field, default in OPTIONAL_FIELDS.items():
        value = (row.get(field) or "").strip() or default
        if field == "confirmed_year" and value not in (None, ""):
            value = int(value)
        properties[field] = value

    return {
        "type": "Feature",
        # GeoJSONの座標順序は [経度, 緯度] （lat/lngの順ではない点に注意）
        "geometry": {"type": "Point", "coordinates": [round(lng, 6), round(lat, 6)]},
        "properties": properties,
    }


def main():
    args = parse_args()

    with args.input_csv.open(encoding=args.encoding, newline="") as f:
        reader = csv.DictReader(f)
        features = [row_to_feature(row, i + 1) for i, row in enumerate(reader)]

    geojson = {"type": "FeatureCollection", "features": features}

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)

    print(f"{len(features)} 件の湧水地点を {args.output} に書き出しました")


if __name__ == "__main__":
    main()
