/**
 * extract_geology_boundary.js
 *
 * 産業技術総合研究所「20万分の1日本シームレス地質図V2」のシェープファイル一式
 * （地質境界線・断層線を含む "line" レイヤー）から、対象エリア（横瀬町・秩父地域）
 * だけを切り出して data/geology_boundary.geojson を作る。
 *
 * データ出典: 産業技術総合研究所 地質調査総合センター
 *   20万分の1日本シームレス地質図V2 (https://gbank.gsj.jp/seamless/)
 *   ライセンス: 政府標準利用規約(第2.0版)相当。出典明記の上で商用利用・改変可
 *   （詳細は https://gbank.gsj.jp/geonavi/license.html 等を参照）
 *
 * 使い方:
 *   cd web/scripts
 *   node extract_geology_boundary.js
 *
 * 全国一括のZIP（約250MB）を raw/seamlessV2.zip にダウンロード（未取得時のみ）した後、
 * 中の seamlessV2_line.shp だけを自前のZIP/Shapefileリーダーでパースし、
 * 対象エリアのバウンディングボックスと交差する線分だけを抜き出す。
 * ZIP自体は重いため .gitignore 対象（raw/）、書き出す geology_boundary.geojson
 * （対象エリア分のみ、数百KB程度）だけを data/ に含める。
 */

const fs = require("fs");
const path = require("path");
const { listEntries, extractEntry } = require("./zip_reader.js");
const { parseShapefile } = require("./shapefile_reader.js");

const ZIP_URL = "https://gbank.gsj.jp/seamless/v2/download/seamlessV2.zip";
const RAW_DIR = path.join(__dirname, "raw");
const ZIP_PATH = path.join(RAW_DIR, "seamlessV2.zip");
const OUTPUT_PATH = path.join(__dirname, "../data/geology_boundary.geojson");

// 対象エリア: DEMと同じくバッファ込みの範囲（JGD2000は実用上WGS84とほぼ同一のため変換なしで扱う）
const BBOX = { minX: 139.0425 - 0.02, minY: 35.9225 - 0.02, maxX: 139.1575 + 0.02, maxY: 36.0375 + 0.02 };

async function downloadZipIfNeeded() {
  if (fs.existsSync(ZIP_PATH)) {
    console.log(`既にダウンロード済み: ${ZIP_PATH}`);
    return;
  }
  console.log(`ダウンロード中: ${ZIP_URL}（約250MB、少し時間がかかります）`);
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const res = await fetch(ZIP_URL);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(ZIP_PATH, buf);
  console.log(`保存しました: ${ZIP_PATH} (${buf.length}バイト)`);
}

async function main() {
  await downloadZipIfNeeded();

  console.log("ZIPを読み込み中...");
  const zipBuffer = fs.readFileSync(ZIP_PATH);
  const entries = listEntries(zipBuffer);
  const lineEntry = entries.find((e) => e.fileName === "seamlessV2_line.shp");
  if (!lineEntry) throw new Error("seamlessV2_line.shp がZIP内に見つかりません");

  console.log(`seamlessV2_line.shp を展開中（展開後 約${(lineEntry.uncompressedSize / 1024 / 1024).toFixed(0)}MB）...`);
  const shpBuffer = extractEntry(zipBuffer, lineEntry);

  console.log("対象エリアと交差する線分を抽出中...");
  const { features } = parseShapefile(shpBuffer, BBOX);
  console.log(`対象エリア内の線分（地質境界・断層）: ${features.length}件`);

  // GeoJSON化。1レコード=1本以上の折れ線（parts）を持つので、MultiLineStringとして書き出す
  const geojsonFeatures = features
    .filter((f) => f.parts.length > 0)
    .map((f, i) => ({
      type: "Feature",
      geometry: {
        type: "MultiLineString",
        coordinates: f.parts.map((part) => part.map(([x, y]) => [Number(x.toFixed(6)), Number(y.toFixed(6))]))
      },
      properties: {
        id: `geology_line_${i}`,
        source: "産業技術総合研究所 地質調査総合センター「20万分の1日本シームレス地質図V2」"
      }
    }));

  const geojson = { type: "FeatureCollection", features: geojsonFeatures };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson));
  console.log(`保存しました: ${OUTPUT_PATH}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
