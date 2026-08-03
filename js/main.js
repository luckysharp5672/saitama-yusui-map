// ============================================================
// main.js
// アプリのエントリーポイント。地図の初期化、データ読み込み、
// レイヤーコントロール/サイドパネル/テーブル/ダウンロードボタンの配線を行う。
// ============================================================
import {
  buildInitialStyle, addTerrainLayers, addPotentialLayer, setPotentialThreshold,
  addSpringsLayer, buildSpringPopupHTML, addRainfallLayer, updateRainfallWeek,
  addWetland1997Layer, setWetland1997CategoryFilter, buildWetland1997PopupHTML,
  addHighlightLayer, setHighlight,
  setLayerVisible, setLayerOpacity
} from "./layers.js";
import { createTableController } from "./table.js";
import { downloadCSV, downloadGeoJSON } from "./export.js";

// 地図の初期表示範囲: 埼玉県秩父地域・横瀬町周辺
const INITIAL_CENTER = [139.10, 35.98];
const INITIAL_ZOOM = 11;

// ---- 地図の初期化 ----
const map = new maplibregl.Map({
  container: "map",
  style: buildInitialStyle(),
  center: INITIAL_CENTER,
  zoom: INITIAL_ZOOM
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

// ---- アプリの状態 ----
const state = {
  springsData: null,
  potentialData: null,
  rainfallData: null,
  wetlandData: null,
  activeTab: "springs",
  threshold: 0,
  weekIndex: 0,
  playTimer: null,
  wetlandOnlySprings: false
};

// パン・ズームの完了(moveend)を待ってから詳細情報を表示するため、
// 直前に登録した待ち受けが残っていれば解除できるよう参照を保持しておく
// （行を連続してクリックしたときに、古い選択の詳細が後から出てしまうのを防ぐため）
let pendingRowSelectMoveEnd = null;

/**
 * 下部テーブルの行がクリックされたときの処理。
 * 選択地点を地図上でリング状に強調表示し、その地点が画面内に収まるよう地図を移動したうえで、
 * 移動が完了した後にその地点の詳細情報（ポップアップ／スコア内訳パネル）を自動で表示する。
 */
function handleTableRowSelect(row) {
  if (row.lng == null || row.lat == null) return;
  const lngLat = [row.lng, row.lat];
  setHighlight(map, lngLat);

  if (pendingRowSelectMoveEnd) {
    map.off("moveend", pendingRowSelectMoveEnd);
    pendingRowSelectMoveEnd = null;
  }
  pendingRowSelectMoveEnd = () => {
    pendingRowSelectMoveEnd = null;
    if (state.activeTab === "springs") {
      new maplibregl.Popup({ closeButton: true }).setLngLat(lngLat).setHTML(buildSpringPopupHTML(row)).addTo(map);
    } else if (state.activeTab === "wetland1997") {
      new maplibregl.Popup({ closeButton: true }).setLngLat(lngLat).setHTML(buildWetland1997PopupHTML(row)).addTo(map);
    } else if (state.activeTab === "potential") {
      showInfoPanel(row);
    }
  };
  map.once("moveend", pendingRowSelectMoveEnd);

  map.easeTo({ center: lngLat, zoom: Math.max(map.getZoom(), 13), duration: 600 });
}

// ---- テーブルコントローラ ----
const tableController = createTableController(
  document.getElementById("data-table"),
  document.getElementById("table-row-count"),
  handleTableRowSelect
);

const SPRINGS_COLUMNS = [
  { key: "name", label: "名称" },
  { key: "municipality", label: "市区町村" },
  { key: "address", label: "所在地" },
  { key: "status", label: "現況" },
  { key: "access", label: "立入" },
  { key: "accuracy", label: "座標精度" },
  { key: "source", label: "出典" },
  { key: "lng", label: "経度" },
  { key: "lat", label: "緯度" }
];

const POTENTIAL_COLUMNS = [
  { key: "cell_id", label: "セルID" },
  { key: "score", label: "スコア" },
  { key: "twi", label: "TWI" },
  { key: "hand", label: "HAND(m)" },
  { key: "dist_to_boundary", label: "地質境界距離(m)" },
  { key: "curvature", label: "曲率" },
  { key: "spring_kde", label: "湧水密度(KDE)" },
  { key: "lng", label: "中心経度" },
  { key: "lat", label: "中心緯度" }
];

const WETLAND_COLUMNS = [
  { key: "name", label: "名称" },
  { key: "municipality", label: "市区町村" },
  { key: "address", label: "所在地" },
  { key: "category", label: "カテゴリ（推定）" },
  { key: "status_note", label: "消失状況" },
  { key: "survey_method", label: "調査方法" },
  { key: "lng", label: "経度" },
  { key: "lat", label: "緯度" }
];

/** ポリゴンの重心（各頂点の単純平均。正方形グリッドなので十分な精度） */
function polygonCentroid(coordinates) {
  const ring = coordinates[0];
  let sumLng = 0, sumLat = 0;
  // 最後の点は最初の点と重複するため除く
  const pts = ring.slice(0, -1);
  pts.forEach(([lng, lat]) => { sumLng += lng; sumLat += lat; });
  return [sumLng / pts.length, sumLat / pts.length];
}

/** Point Feature をテーブル/CSV/GeoJSON出力で使う「フラットな行オブジェクト」に変換する（湧水地点・1997年湿地台帳の両方で使う） */
function pointFeatureToRow(f) {
  const [lng, lat] = f.geometry.coordinates;
  return { ...f.properties, lng: Number(lng.toFixed(5)), lat: Number(lat.toFixed(5)) };
}
function potentialFeatureToRow(f) {
  const [lng, lat] = polygonCentroid(f.geometry.coordinates);
  return { ...f.properties, lng: Number(lng.toFixed(5)), lat: Number(lat.toFixed(5)) };
}

/** 現在のスコア閾値でフィルタしたポテンシャルグリッドのfeature配列を返す */
function filteredPotentialFeatures() {
  if (!state.potentialData) return [];
  return state.potentialData.features.filter((f) => f.properties.score >= state.threshold);
}

/** 現在の「湧水・井戸のみ表示」設定でフィルタした1997年湿地台帳のfeature配列を返す */
function filteredWetlandFeatures() {
  if (!state.wetlandData) return [];
  if (!state.wetlandOnlySprings) return state.wetlandData.features;
  return state.wetlandData.features.filter((f) => f.properties.category === "湧水・井戸");
}

/** 現在アクティブなタブのテーブルを再描画する */
function refreshTable() {
  if (state.activeTab === "springs") {
    const rows = (state.springsData?.features || []).map(pointFeatureToRow);
    tableController.setData(SPRINGS_COLUMNS, rows);
  } else if (state.activeTab === "potential") {
    const rows = filteredPotentialFeatures().map(potentialFeatureToRow);
    tableController.setData(POTENTIAL_COLUMNS, rows);
  } else {
    const rows = filteredWetlandFeatures().map(pointFeatureToRow);
    tableController.setData(WETLAND_COLUMNS, rows);
  }
}

// ---- 地図読み込み後の初期化 ----
map.on("load", async () => {
  addTerrainLayers(map);

  const [springs, potential, rainfall, wetland] = await Promise.all([
    fetch("data/springs.geojson").then((r) => r.json()),
    fetch("data/potential_grid.geojson").then((r) => r.json()),
    fetch("data/rainfall_weekly.json").then((r) => r.json()),
    fetch("data/wetland_1997.geojson").then((r) => r.json())
  ]);
  state.springsData = springs;
  state.potentialData = potential;
  state.rainfallData = rainfall;
  state.wetlandData = wetland;

  addPotentialLayer(map, potential);
  addSpringsLayer(map, springs);
  addRainfallLayer(map, rainfall, 0);
  addWetland1997Layer(map, wetland);
  addHighlightLayer(map); // 他のレイヤーより後に追加し、最前面に描画されるようにする

  updateWeekLabel();
  refreshTable();

  // ---- 湧水地点クリック: ポップアップ表示 ----
  map.on("click", "springs-points", (e) => {
    const f = e.features[0];
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(f.geometry.coordinates)
      .setHTML(buildSpringPopupHTML(f.properties))
      .addTo(map);
  });

  // ---- ポテンシャルグリッドクリック: サイドパネルにスコア内訳表示 ----
  map.on("click", "potential-fill", (e) => {
    showInfoPanel(e.features[0].properties);
  });

  // ---- 1997年湿地台帳クリック: ポップアップ表示 ----
  map.on("click", "wetland1997-points", (e) => {
    const f = e.features[0];
    new maplibregl.Popup({ closeButton: true })
      .setLngLat(f.geometry.coordinates)
      .setHTML(buildWetland1997PopupHTML(f.properties))
      .addTo(map);
  });

  ["springs-points", "potential-fill", "wetland1997-points"].forEach((layerId) => {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  });
});

// ---- サイドパネル（スコア内訳） ----
function showInfoPanel(props) {
  const panel = document.getElementById("info-panel");
  const content = document.getElementById("info-panel-content");
  const scorePct = Math.round(props.score * 100);
  content.innerHTML = `
    <p class="info-title">セル: ${props.cell_id}</p>
    <p class="info-sub">湧水ポテンシャルスコアの内訳（ダミーデータ）</p>
    <div class="info-score-bar-wrap">
      <div>総合スコア: <strong>${props.score.toFixed(3)}</strong></div>
      <div class="info-score-bar-bg"><div class="info-score-bar-fill" style="width:${scorePct}%"></div></div>
    </div>
    <table class="info-table">
      <tr><th>地形湿潤指数 TWI</th><td>${props.twi}</td></tr>
      <tr><th>HAND（最近接水路比高, m）</th><td>${props.hand}</td></tr>
      <tr><th>地質境界までの距離（m）</th><td>${props.dist_to_boundary}</td></tr>
      <tr><th>曲率（遷急線/遷緩線指標）</th><td>${props.curvature}</td></tr>
      <tr><th>既知湧水カーネル密度</th><td>${props.spring_kde}</td></tr>
    </table>`;
  panel.classList.remove("hidden");
}
document.getElementById("close-info-panel").addEventListener("click", () => {
  document.getElementById("info-panel").classList.add("hidden");
});

// ============================================================
// レイヤーコントロールパネルの配線
// ============================================================

// -- 既知湧水地点 --
document.getElementById("toggle-springs").addEventListener("change", (e) => {
  setLayerVisible(map, "springs-points", e.target.checked);
});
document.getElementById("opacity-springs").addEventListener("input", (e) => {
  setLayerOpacity(map, "springs-points", Number(e.target.value), "circle-opacity");
});

// -- 湧水ポテンシャルスコア --
document.getElementById("toggle-potential").addEventListener("change", (e) => {
  setLayerVisible(map, "potential-fill", e.target.checked);
});
document.getElementById("opacity-potential").addEventListener("input", (e) => {
  setLayerOpacity(map, "potential-fill", Number(e.target.value), "fill-opacity");
});
document.getElementById("threshold-potential").addEventListener("input", (e) => {
  state.threshold = Number(e.target.value);
  document.getElementById("threshold-value").textContent = state.threshold.toFixed(2);
  if (map.getLayer("potential-fill")) setPotentialThreshold(map, state.threshold);
  if (state.activeTab === "potential") refreshTable();
});

// -- 週別降水量 --
document.getElementById("toggle-rainfall").addEventListener("change", (e) => {
  setLayerVisible(map, "rainfall-fill", e.target.checked);
});
document.getElementById("opacity-rainfall").addEventListener("input", (e) => {
  setLayerOpacity(map, "rainfall-fill", Number(e.target.value), "fill-opacity");
});

function updateWeekLabel() {
  const label = document.getElementById("week-label");
  if (state.rainfallData) {
    label.textContent = state.rainfallData.meta.weeks[state.weekIndex] + " 週";
  }
}

document.getElementById("week-slider").addEventListener("input", (e) => {
  state.weekIndex = Number(e.target.value);
  updateWeekLabel();
  if (state.rainfallData && map.getSource("rainfall")) {
    updateRainfallWeek(map, state.rainfallData, state.weekIndex);
  }
});

const weekPlayButton = document.getElementById("week-play");
weekPlayButton.addEventListener("click", () => {
  if (state.playTimer) {
    clearInterval(state.playTimer);
    state.playTimer = null;
    weekPlayButton.textContent = "▶ 再生";
    return;
  }
  weekPlayButton.textContent = "■ 停止";
  const slider = document.getElementById("week-slider");
  state.playTimer = setInterval(() => {
    const maxWeek = Number(slider.max);
    state.weekIndex = state.weekIndex >= maxWeek ? 0 : state.weekIndex + 1;
    slider.value = String(state.weekIndex);
    updateWeekLabel();
    if (state.rainfallData && map.getSource("rainfall")) {
      updateRainfallWeek(map, state.rainfallData, state.weekIndex);
    }
  }, 700);
});

// -- 背景地形（陰影段彩図・傾斜量図） --
document.getElementById("toggle-hillshade").addEventListener("change", (e) => {
  setLayerVisible(map, "hillshade-layer", e.target.checked);
});
document.getElementById("opacity-hillshade").addEventListener("input", (e) => {
  setLayerOpacity(map, "hillshade-layer", Number(e.target.value), "raster-opacity");
});
document.getElementById("toggle-slope").addEventListener("change", (e) => {
  setLayerVisible(map, "slope-layer", e.target.checked);
});
document.getElementById("opacity-slope").addEventListener("input", (e) => {
  setLayerOpacity(map, "slope-layer", Number(e.target.value), "raster-opacity");
});

// -- 1997年 埼玉県湿地湧水地台帳（歴史データ） --
document.getElementById("toggle-wetland1997").addEventListener("change", (e) => {
  setLayerVisible(map, "wetland1997-points", e.target.checked);
});
document.getElementById("opacity-wetland1997").addEventListener("input", (e) => {
  setLayerOpacity(map, "wetland1997-points", Number(e.target.value), "circle-opacity");
});
document.getElementById("toggle-wetland1997-onlysprings").addEventListener("change", (e) => {
  state.wetlandOnlySprings = e.target.checked;
  if (map.getLayer("wetland1997-points")) setWetland1997CategoryFilter(map, state.wetlandOnlySprings);
  if (state.activeTab === "wetland1997") refreshTable();
});

// -- レイヤーパネルの表示切替（モバイル向け） --
document.getElementById("toggle-layer-panel").addEventListener("click", () => {
  document.getElementById("layer-panel").classList.toggle("hidden");
});

// ============================================================
// 下部テーブルパネルの配線
// ============================================================

document.querySelectorAll(".tab-button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.activeTab = btn.dataset.tab;
    refreshTable();
    setHighlight(map, null); // タブを切り替えたら、別データセットの地点を指したままにならないよう強調表示を消す
  });
});

document.getElementById("toggle-table-panel").addEventListener("click", (e) => {
  const panel = document.getElementById("table-panel");
  panel.classList.toggle("collapsed");
  e.target.textContent = panel.classList.contains("collapsed") ? "▴" : "▾";
});

// ---- CSVダウンロード: テーブルに表示中のデータをそのまま出力 ----
document.getElementById("btn-download-csv").addEventListener("click", () => {
  const columns = tableController.getColumns();
  const rows = tableController.getSortedRows();
  const filenames = { springs: "springs.csv", potential: "potential_grid.csv", wetland1997: "wetland_1997.csv" };
  downloadCSV(columns, rows, filenames[state.activeTab]);
});

// ---- GeoJSONダウンロード: 現在の地図表示範囲 × 選択レイヤーのフィルタ条件に合致するデータを出力 ----
document.getElementById("btn-download-geojson").addEventListener("click", () => {
  const bounds = map.getBounds();

  if (state.activeTab === "springs") {
    const features = (state.springsData?.features || []).filter((f) =>
      bounds.contains(f.geometry.coordinates)
    );
    downloadGeoJSON({ type: "FeatureCollection", features }, "springs_export.geojson");
  } else if (state.activeTab === "potential") {
    const features = filteredPotentialFeatures().filter((f) => {
      const centroid = polygonCentroid(f.geometry.coordinates);
      return bounds.contains(centroid);
    });
    downloadGeoJSON({ type: "FeatureCollection", features }, "potential_grid_export.geojson");
  } else {
    const features = filteredWetlandFeatures().filter((f) => bounds.contains(f.geometry.coordinates));
    downloadGeoJSON({ type: "FeatureCollection", features }, "wetland_1997_export.geojson");
  }
});
