/**
 * fetch_wetland_1997.js
 *
 * 埼玉県環境科学国際センター「Atlas Eco Saitama」が公開している
 * 1997年版 埼玉県湿地湧水地台帳（1997年に埼玉県環境生活部自然環境課が作成した
 * 湿地・湧水地マップをデジタル化したもの）を取得し、data/wetland_1997.geojson を生成する。
 *
 * 公開ダッシュボード（人が見るためのアプリ）:
 *   https://atlas-eco-saitama-pref-saitama.hub.arcgis.com/apps/50e96c8bc0cf4bd29418301d7640b33d/explore
 * このダッシュボードの背後にある ArcGIS Online の Web Map アイテムをたどり、
 * 実データを保持している ArcGIS FeatureServer（匿名クエリ可）を直接呼び出している。
 *
 * 【重要】このデータは1997年時点のスナップショットであり、現況とは大きく異なる場合がある。
 * また「湿地種類」「湿地自然度」は元データにコード値（0-4等）として入っているが、
 * サービス側に凡例（コード値の意味）が公開されていないため、本スクリプトでは
 * 名称文字列からのキーワード判定で独自に category（湧水・井戸／池・沼／河川・水路／
 * 湿地・湿原／その他）を推定し付与している。元のコード値も raw_type_code /
 * raw_naturalness_code としてそのまま残してあるので、正確な凡例が分かった場合は
 * classify() を書き換えて再生成すること。
 *
 * 依存パッケージなし（Node.js 18+ の組み込み fetch のみを使用）。
 *
 * 使い方:
 *   cd web/scripts
 *   node fetch_wetland_1997.js
 *   （実行すると ../data/wetland_1997.geojson を上書きします）
 */

const fs = require("fs");
const path = require("path");

const FEATURE_SERVER_URL =
  "https://services9.arcgis.com/n65w8AXGaYPTqFYI/arcgis/rest/services/" +
  "%E6%B9%BF%E5%9C%B0%E6%B9%A7%E6%B0%B4%E5%9C%B0%E3%81%AE%E9%87%8D%E5%BF%83/FeatureServer/0/query";
const DASHBOARD_URL =
  "https://atlas-eco-saitama-pref-saitama.hub.arcgis.com/apps/50e96c8bc0cf4bd29418301d7640b33d/explore";
const OUTPUT_PATH = path.join(__dirname, "../data/wetland_1997.geojson");

/** 名称の文字列から、独自のカテゴリ（表示・絞り込み用）を推定する */
function classify(name) {
  const n = name || "";
  if (/湧水|湧き水|湧出|清水|井戸|滝/.test(n)) return "湧水・井戸";
  if (/池|沼/.test(n)) return "池・沼";
  if (/川|河原|瀬|水路|用水/.test(n)) return "河川・水路";
  if (/湿地|湿原|谷津/.test(n)) return "湿地・湿原";
  return "その他";
}

async function main() {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "*",
    outSR: "4326", // 緯度経度（WGS84）で受け取る
    f: "geojson"
  });

  console.log("Fetching wetland/spring FeatureServer ...");
  const res = await fetch(`${FEATURE_SERVER_URL}?${params.toString()}`);
  const raw = await res.json();

  if (!raw.features) {
    throw new Error("FeatureServerからの応答にfeaturesが含まれていません: " + JSON.stringify(raw).slice(0, 300));
  }
  console.log(`Fetched ${raw.features.length} features.`);

  const features = raw.features.map((f, idx) => {
    const p = f.properties;
    const name = (p["名称"] || "").trim() || "(名称未記載)";
    const statusRaw = (p["消失状況"] || "").trim();

    return {
      type: "Feature",
      geometry: f.geometry,
      properties: {
        id: `wetland1997_${String(idx + 1).padStart(3, "0")}`,
        name,
        municipality: (p["市町村名"] || "").trim(),
        address: (p["所在地"] || "").trim() || null,
        category: classify(name),
        wetland_no: p["湿地No"],
        raw_type_code: p["湿地種類"],
        raw_naturalness_code: p["湿地自然度"],
        status_note: statusRaw || null, // 空欄=現存、値ありなら消失/縮小等の記録
        survey_method: (p["調査方法"] || "").trim() || null,
        survey_year: 1997,
        source: "埼玉県環境科学国際センター「1997年版 埼玉県湿地湧水地台帳」（原典: 埼玉県環境生活部自然環境課, 1997年作成）",
        source_url: DASHBOARD_URL,
        data_note:
          "1997年時点のスナップショットです。現況とは大きく異なる場合があります。" +
          "categoryは名称文字列からこのスクリプトが独自に推定した分類で、出典データ本来の区分ではありません。"
      }
    };
  });

  const geojson = { type: "FeatureCollection", features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson));

  const counts = {};
  features.forEach((f) => { counts[f.properties.category] = (counts[f.properties.category] || 0) + 1; });
  console.log(`Wrote ${features.length} features to ${OUTPUT_PATH}`);
  console.log("category counts:", counts);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
