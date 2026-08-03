// ============================================================
// layers.js
// 各レイヤー（既知湧水地点・湧水ポテンシャルスコア・週別降水量・
// 背景地形）のMapLibreへの追加、スタイル設定、表示切替ロジックをまとめたモジュール。
// ============================================================

// ---- 国土地理院タイル（背景地図・陰影段彩図・傾斜量図） ----
// 出典: 国土地理院ウェブサイト（https://maps.gsi.go.jp/development/ichiran.html）
const GSI_STD_URL = "https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png";
const GSI_HILLSHADE_URL = "https://cyberjapandata.gsi.go.jp/xyz/hillshademap/{z}/{x}/{y}.png";
const GSI_SLOPE_URL = "https://cyberjapandata.gsi.go.jp/xyz/slopemap/{z}/{x}/{y}.png";

/**
 * 地図の初期スタイル（背景の標準地図タイル）を組み立てる。
 * MapLibreは style.json形式でソース/レイヤーを定義する。
 */
export function buildInitialStyle() {
  return {
    version: 8,
    sources: {
      "gsi-std": {
        type: "raster",
        tiles: [GSI_STD_URL],
        tileSize: 256,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（国土地理院）</a>'
      }
    },
    layers: [
      { id: "gsi-std-layer", type: "raster", source: "gsi-std" }
    ]
  };
}

/**
 * 背景地形（陰影段彩図・傾斜量図）のラスターソース/レイヤーを追加する。
 * 初期状態では非表示（visibility: none）にしておき、チェックボックスで切り替える。
 */
export function addTerrainLayers(map) {
  map.addSource("gsi-hillshade", {
    type: "raster",
    tiles: [GSI_HILLSHADE_URL],
    tileSize: 256,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（国土地理院）</a>'
  });
  map.addLayer({
    id: "hillshade-layer",
    type: "raster",
    source: "gsi-hillshade",
    layout: { visibility: "none" },
    paint: { "raster-opacity": 0.6 }
  });

  map.addSource("gsi-slope", {
    type: "raster",
    tiles: [GSI_SLOPE_URL],
    tileSize: 256,
    attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル（国土地理院）</a>'
  });
  map.addLayer({
    id: "slope-layer",
    type: "raster",
    source: "gsi-slope",
    layout: { visibility: "none" },
    paint: { "raster-opacity": 0.6 }
  });
}

/**
 * 湧水ポテンシャルスコアのグリッド（塗りつぶしポリゴン）を追加する。
 * スコア(0-1)を単一色相（青）の連続配色で表現する。
 */
export function addPotentialLayer(map, geojson) {
  map.addSource("potential", { type: "geojson", data: geojson });

  map.addLayer({
    id: "potential-fill",
    type: "fill",
    source: "potential",
    paint: {
      "fill-color": [
        "interpolate", ["linear"], ["get", "score"],
        0,    "#cde2fb",
        0.15, "#9ec5f4",
        0.3,  "#5598e7",
        0.45, "#2a78d6",
        0.6,  "#1c5cab",
        0.8,  "#104281",
        1,    "#0d366b"
      ],
      "fill-opacity": 0.75,
      "fill-outline-color": "rgba(0,0,0,0.05)"
    }
  });
}

/** ポテンシャルグリッドの表示閾値（スコア >= threshold のセルのみ表示）を更新する */
export function setPotentialThreshold(map, threshold) {
  map.setFilter("potential-fill", [">=", ["get", "score"], threshold]);
}

/**
 * 既知湧水地点（ポイント）レイヤーを追加する。
 * 塗り色は現況（湧出中/枯渇/不明）、枠線は座標精度（正確/おおよそ）で表現する。
 * 「おおよそ」（住所に番地の記載が無く、地区の代表地点で推定した地点）はオレンジの太い枠線で
 * 視覚的に区別し、位置が推定であることが地図上でもひと目で分かるようにしてある。
 */
export function addSpringsLayer(map, geojson) {
  map.addSource("springs", { type: "geojson", data: geojson });

  map.addLayer({
    id: "springs-points",
    type: "circle",
    source: "springs",
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 3, 14, 8],
      "circle-color": [
        "match", ["get", "status"],
        "湧出中", "#2a78d6",
        "枯渇", "#898781",
        "#eda100" // 不明・その他
      ],
      "circle-stroke-width": ["match", ["get", "accuracy"], "おおよそ", 2.5, 1.5],
      "circle-stroke-color": ["match", ["get", "accuracy"], "おおよそ", "#eb6834", "#ffffff"]
    }
  });
}

// アクセス区分（環境省データの凡例）の説明文
const ACCESS_LEGEND = {
  "☆": "可（目視・近接・触れる）",
  "◎": "可（目視・近接）",
  "○": "可（目視のみ）",
  "×": "不可",
  "―": "不明"
};

/** 湧水地点クリック時に表示するポップアップHTMLを組み立てる */
export function buildSpringPopupHTML(props) {
  const accuracyBadge = props.accuracy === "おおよそ"
    ? `<p class="spring-popup-warn">⚠ 位置情報はおおよそ（推定）です</p>`
    : "";
  const accessText = props.access ? (ACCESS_LEGEND[props.access] || props.access) : "";
  const rows = [
    props.municipality && props.address ? ["所在地", `${props.municipality} ${props.address}`] : null,
    props.status ? ["現況", props.status] : null,
    props.confirmed_year ? ["確認年", String(props.confirmed_year)] : null,
    ["座標精度", props.accuracy],
    accessText ? ["立入", accessText] : null,
    props.conservation_activity ? ["保全活動", props.conservation_activity] : null,
    props.source ? ["出典", props.source] : null
  ].filter(Boolean);

  return `
    <div class="spring-popup">
      <h3>${escapeHTML(props.name)}</h3>
      ${accuracyBadge}
      ${props.description ? `<p class="spring-popup-desc">${escapeHTML(props.description)}</p>` : ""}
      <table>
        ${rows.map(([label, value]) => `<tr><td>${escapeHTML(label)}</td><td>${escapeHTML(value)}</td></tr>`).join("")}
      </table>
      ${props.accuracy === "おおよそ" && props.position_note ? `<p class="spring-popup-note">${escapeHTML(props.position_note)}</p>` : ""}
    </div>`;
}

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ---- 1997年 埼玉県湿地湧水地台帳（歴史データ）レイヤー ----

// カテゴリごとの色（wetland_1997.geojson の category プロパティに対応）
// 他レイヤー（既知湧水地点の青/オレンジ、ポテンシャルの青、降水量のオレンジ）と
// 見分けやすいよう、それらとは異なる色相を割り当てている。
const WETLAND_CATEGORY_COLORS = {
  "湧水・井戸": "#1baf7a", // aqua
  "池・沼": "#e87ba4",     // magenta
  "河川・水路": "#4a3aa7", // violet
  "湿地・湿原": "#eda100", // yellow
  "その他": "#898781"      // gray
};

/**
 * 1997年 埼玉県湿地湧水地台帳（歴史データ）のポイントレイヤーを追加する。
 * 塗り色はカテゴリ（名称からの推定分類）、枠線は消失状況（記録が無ければ現存とみなし白、
 * 消失・縮小等の記録があれば赤の太枠）で表現する。
 */
export function addWetland1997Layer(map, geojson) {
  map.addSource("wetland1997", { type: "geojson", data: geojson });

  const colorMatch = ["match", ["get", "category"]];
  Object.entries(WETLAND_CATEGORY_COLORS).forEach(([category, color]) => {
    colorMatch.push(category, color);
  });
  colorMatch.push(WETLAND_CATEGORY_COLORS["その他"]); // フォールバック

  map.addLayer({
    id: "wetland1997-points",
    type: "circle",
    source: "wetland1997",
    layout: { visibility: "none" },
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 8, 2, 14, 6],
      "circle-color": colorMatch,
      "circle-opacity": 0.85,
      "circle-stroke-width": ["case", ["!=", ["get", "status_note"], null], 2, 1],
      "circle-stroke-color": ["case", ["!=", ["get", "status_note"], null], "#e34948", "#ffffff"]
    }
  });
}

/** 「湧水・井戸」カテゴリのみ表示するフィルタを適用/解除する */
export function setWetland1997CategoryFilter(map, onlySprings) {
  map.setFilter("wetland1997-points", onlySprings ? ["==", ["get", "category"], "湧水・井戸"] : null);
}

/** 1997年湿地台帳のポイントクリック時に表示するポップアップHTMLを組み立てる */
export function buildWetland1997PopupHTML(props) {
  const statusText = props.status_note ? `⚠ 消失・変化の記録あり: ${props.status_note}` : "現存（1997年調査時点、消失の記録なし）";
  const rows = [
    ["市区町村", props.municipality || "不明"],
    props.address ? ["所在地", props.address] : null,
    ["カテゴリ（推定）", props.category],
    ["消失状況", statusText],
    props.survey_method ? ["調査方法", props.survey_method] : null,
    ["調査年", "1997年"],
    ["出典", props.source]
  ].filter(Boolean);

  return `
    <div class="spring-popup">
      <h3>${escapeHTML(props.name)}</h3>
      <p class="spring-popup-warn">⚠ 1997年時点のスナップショットです（現況とは異なる場合があります）</p>
      <table>
        ${rows.map(([label, value]) => `<tr><td>${escapeHTML(label)}</td><td>${escapeHTML(value)}</td></tr>`).join("")}
      </table>
      <p class="spring-popup-note">${escapeHTML(props.data_note)}</p>
    </div>`;
}

// ---- 週別降水量レイヤー ----

/**
 * rainfall_weekly.json の regions（市町村ごとのポリゴン＋週別配列）から、
 * 指定した週インデックスの値を properties.value に持つGeoJSONを組み立てる。
 */
export function buildRainfallGeoJSON(rainfallData, weekIndex) {
  return {
    type: "FeatureCollection",
    features: rainfallData.regions.map((r) => ({
      type: "Feature",
      geometry: r.geometry,
      properties: {
        code: r.code,
        name: r.name,
        week: rainfallData.meta.weeks[weekIndex],
        value: r.weekly[weekIndex]
      }
    }))
  };
}

export function addRainfallLayer(map, rainfallData, weekIndex) {
  map.addSource("rainfall", { type: "geojson", data: buildRainfallGeoJSON(rainfallData, weekIndex) });

  map.addLayer({
    id: "rainfall-fill",
    type: "fill",
    source: "rainfall",
    layout: { visibility: "none" },
    paint: {
      "fill-color": [
        "interpolate", ["linear"], ["get", "value"],
        0,   "#fde3d3",
        20,  "#f8b892",
        40,  "#f28f5c",
        60,  "#eb6834",
        90,  "#b8431a",
        120, "#7a2c0f"
      ],
      "fill-opacity": 0.7,
      "fill-outline-color": "rgba(0,0,0,0.15)"
    }
  });
}

/** 週スライダーの値が変わったときに、降水量レイヤーのデータを差し替える */
export function updateRainfallWeek(map, rainfallData, weekIndex) {
  const source = map.getSource("rainfall");
  if (source) source.setData(buildRainfallGeoJSON(rainfallData, weekIndex));
}

// ---- 共通: レイヤー表示/非表示・不透明度 ----

export function setLayerVisible(map, layerId, visible) {
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

export function setLayerOpacity(map, layerId, opacity, paintProp) {
  map.setPaintProperty(layerId, paintProp, opacity);
}
