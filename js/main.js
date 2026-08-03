// ============================================================
// main.js
// アプリのエントリーポイント。地図の初期化、データ読み込み、
// レイヤーコントロール/サイドパネル/テーブル/ダウンロードボタンの配線を行う。
// ============================================================
import {
  buildInitialStyle, addTerrainLayers, addPotentialLayer, setPotentialThreshold,
  addSpringsLayer, buildSpringPopupHTML, addRainfallLayer, updateRainfallWeek,
  addWetland1997Layer, setWetland1997CategoryFilter, buildWetland1997PopupHTML,
  addFieldSurveyLayer, updateFieldSurveyData, buildFieldSurveyPopupHTML,
  addHighlightLayer, setHighlight,
  setLayerVisible, setLayerOpacity
} from "./layers.js";
import { createTableController } from "./table.js";
import { downloadCSV, downloadGeoJSON } from "./export.js";
import { createFieldSurveyStore, mergeFieldSurveyData } from "./fieldSurvey.js";

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
  fieldSurveyLoadedData: null, // data/field_survey.geojson から読み込んだ「確定済み」の記録
  activeTab: "springs",
  threshold: 0,
  weekIndex: 0,
  playTimer: null,
  wetlandOnlySprings: false
};

// 現地調査の下書き（ブラウザのlocalStorageに保存）を管理するストア
const fieldSurveyStore = createFieldSurveyStore();

/** 確定済みデータ + ローカル下書きをマージした、表示・エクスポート用の現地調査記録一式を返す */
function getCombinedFieldSurveyData() {
  return mergeFieldSurveyData(state.fieldSurveyLoadedData, fieldSurveyStore.getDrafts());
}

/** 下書きの追加・削除のたびに呼ぶ: 地図上のバッジを更新し、テーブルを開いていれば再描画する */
function refreshFieldSurveyLayer() {
  const combined = getCombinedFieldSurveyData();
  if (map.getSource("fieldsurvey")) updateFieldSurveyData(map, combined);
  if (state.activeTab === "fieldsurvey") refreshTable();
}

/**
 * ポップアップを開き、中に含まれる「📝 現地調査を記録」「🗑 下書きを削除」ボタンを配線する。
 * ポップアップHTMLはlayers.js側で文字列として組み立てているため、DOMに挿入された後に
 * イベントリスナーを付け直す必要がある（=イベント委譲）。
 */
function openDetailPopup(lngLat, html) {
  const popup = new maplibregl.Popup({ closeButton: true }).setLngLat(lngLat).setHTML(html).addTo(map);
  const el = popup.getElement();

  const recordBtn = el.querySelector(".popup-record-survey-btn");
  if (recordBtn) {
    recordBtn.addEventListener("click", () => {
      const { targetDataset, targetId, targetName } = recordBtn.dataset;
      const clickedAt = popup.getLngLat();
      popup.remove();
      openSurveyForm({ targetDataset, targetId, targetName, lngLat: clickedAt });
    });
  }

  const deleteBtn = el.querySelector(".popup-delete-draft-btn");
  if (deleteBtn) {
    deleteBtn.addEventListener("click", () => {
      if (window.confirm("この現地調査記録の下書きを削除しますか？（この端末に保存されているだけの下書きです）")) {
        fieldSurveyStore.deleteDraft(deleteBtn.dataset.draftId);
        refreshFieldSurveyLayer();
        popup.remove();
      }
    });
  }

  return popup;
}

// パン・ズームの完了(moveend)を待ってから詳細情報を表示するため、
// 直前に登録した待ち受けが残っていれば解除できるよう参照を保持しておく
// （行を連続してクリックしたときに、古い選択の詳細が後から出てしまうのを防ぐため）
let pendingRowSelectMoveEnd = null;

// 行選択によって開いた詳細ポップアップの一覧。選択が変わるたびに全部閉じてから開き直す
// （地図を直接クリックして開くポップアップとは別管理。あちらは触らない）。
let tableSelectionPopups = [];
function clearTableSelectionPopups() {
  tableSelectionPopups.forEach((p) => p.remove());
  tableSelectionPopups = [];
}

/**
 * 下部テーブルの行選択が変わったときの処理。
 * 選択中の全地点を地図上でリング状に強調表示し、それら全てが画面内に収まるよう地図を
 * 移動したうえで、移動完了後に選択件数ぶんの詳細情報を表示する
 * （湧水地点・1997年台帳・現地調査記録タブ→地点ごとに独立したポップアップ、
 * 　ポテンシャルグリッドタブ→右パネルにスコア内訳カードを選択件数ぶん積み上げて表示）。
 * 1件だけ選択されていれば、結果として詳細画面も1つだけになる。
 */
function handleTableSelectionChange(rows) {
  clearTableSelectionPopups();
  const points = rows
    .filter((r) => r.lng != null && r.lat != null)
    .map((r) => /** @type {[number, number]} */ ([r.lng, r.lat]));

  if (pendingRowSelectMoveEnd) {
    map.off("moveend", pendingRowSelectMoveEnd);
    pendingRowSelectMoveEnd = null;
  }

  if (points.length === 0) {
    setHighlight(map, null);
    document.getElementById("info-panel").classList.add("hidden");
    return;
  }

  setHighlight(map, points);

  pendingRowSelectMoveEnd = () => {
    pendingRowSelectMoveEnd = null;
    if (state.activeTab === "potential") {
      showInfoPanel(rows);
    } else {
      rows.forEach((row) => {
        if (row.lng == null || row.lat == null) return;
        const lngLat = [row.lng, row.lat];
        const html =
          state.activeTab === "springs" ? buildSpringPopupHTML(row) :
          state.activeTab === "wetland1997" ? buildWetland1997PopupHTML(row) :
          buildFieldSurveyPopupHTML(row);
        tableSelectionPopups.push(openDetailPopup(lngLat, html));
      });
    }
  };
  map.once("moveend", pendingRowSelectMoveEnd);

  if (points.length === 1) {
    map.easeTo({ center: points[0], zoom: Math.max(map.getZoom(), 13), duration: 600 });
  } else {
    const bounds = points.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(points[0], points[0])
    );
    map.fitBounds(bounds, { padding: 100, maxZoom: 15, duration: 600 });
  }
}

// ---- テーブルコントローラ ----
const tableController = createTableController(
  document.getElementById("data-table"),
  document.getElementById("table-row-count"),
  handleTableSelectionChange
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

const FIELDSURVEY_COLUMNS = [
  { key: "target_name", label: "対象地点" },
  { key: "surveyed_at", label: "確認日" },
  { key: "status", label: "現況" },
  { key: "address_note", label: "所在地メモ" },
  { key: "surveyor", label: "調査者" },
  { key: "notes", label: "備考" },
  { key: "record_state", label: "状態" },
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
/** 現地調査記録用: is_draft(真偽値)を表示用の文字列に変換してから行データにする */
function fieldSurveyFeatureToRow(f) {
  const row = pointFeatureToRow(f);
  row.record_state = row.is_draft ? "下書き（未エクスポート）" : "確定済み";
  return row;
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
  } else if (state.activeTab === "wetland1997") {
    const rows = filteredWetlandFeatures().map(pointFeatureToRow);
    tableController.setData(WETLAND_COLUMNS, rows);
  } else if (state.activeTab === "fieldsurvey") {
    const rows = getCombinedFieldSurveyData().features.map(fieldSurveyFeatureToRow);
    tableController.setData(FIELDSURVEY_COLUMNS, rows);
  }
}

// ---- 地図読み込み後の初期化 ----
map.on("load", async () => {
  addTerrainLayers(map);

  const [springs, potential, rainfall, wetland, fieldSurvey] = await Promise.all([
    fetch("data/springs.geojson").then((r) => r.json()),
    fetch("data/potential_grid.geojson").then((r) => r.json()),
    fetch("data/rainfall_weekly.json").then((r) => r.json()),
    fetch("data/wetland_1997.geojson").then((r) => r.json()),
    // 現地調査記録（確定済み分）。まだ一度もエクスポートしていない場合でも
    // 空のFeatureCollectionとして存在するようシードしてあるが、念のためフォールバックする
    fetch("data/field_survey.geojson").then((r) => r.json()).catch(() => ({ type: "FeatureCollection", features: [] }))
  ]);
  state.springsData = springs;
  state.potentialData = potential;
  state.rainfallData = rainfall;
  state.wetlandData = wetland;
  state.fieldSurveyLoadedData = fieldSurvey;

  addPotentialLayer(map, potential);
  addSpringsLayer(map, springs);
  addRainfallLayer(map, rainfall, 0);
  addWetland1997Layer(map, wetland);
  addFieldSurveyLayer(map, getCombinedFieldSurveyData());
  addHighlightLayer(map); // 他のレイヤーより後に追加し、最前面に描画されるようにする

  updateWeekLabel();
  refreshTable();

  // ---- 湧水地点クリック: ポップアップ表示 ----
  map.on("click", "springs-points", (e) => {
    const f = e.features[0];
    openDetailPopup(f.geometry.coordinates, buildSpringPopupHTML(f.properties));
  });

  // ---- ポテンシャルグリッドクリック: サイドパネルにスコア内訳表示 ----
  map.on("click", "potential-fill", (e) => {
    showInfoPanel([e.features[0].properties]);
  });

  // ---- 1997年湿地台帳クリック: ポップアップ表示 ----
  map.on("click", "wetland1997-points", (e) => {
    const f = e.features[0];
    openDetailPopup(f.geometry.coordinates, buildWetland1997PopupHTML(f.properties));
  });

  // ---- 現地調査記録クリック: ポップアップ表示 ----
  map.on("click", "fieldsurvey-badge-outer", (e) => {
    const f = e.features[0];
    openDetailPopup(f.geometry.coordinates, buildFieldSurveyPopupHTML(f.properties));
  });

  ["springs-points", "potential-fill", "wetland1997-points", "fieldsurvey-badge-outer"].forEach((layerId) => {
    map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
  });
});

// ---- サイドパネル（スコア内訳） ----
// 複数セルが選択されている場合は、その件数ぶんカードを積み上げて表示する
// （#info-panel は元々overflow-y:autoなので、積み上げた分は自動でスクロールできる）。
function showInfoPanel(propsList) {
  const panel = document.getElementById("info-panel");
  const content = document.getElementById("info-panel-content");

  content.innerHTML = propsList
    .map((props) => {
      const scorePct = Math.round(props.score * 100);
      return `
    <div class="info-block">
      <p class="info-title">セル: ${props.cell_id}</p>
      <p class="info-sub">湧水ポテンシャルスコアの内訳（DEM等から算出した実データ）</p>
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
      </table>
    </div>`;
    })
    .join('<hr class="info-block-divider" />');
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

// -- 現地調査記録 --
document.getElementById("toggle-fieldsurvey").addEventListener("change", (e) => {
  setLayerVisible(map, "fieldsurvey-badge-outer", e.target.checked);
  setLayerVisible(map, "fieldsurvey-badge-inner", e.target.checked);
});
document.getElementById("opacity-fieldsurvey").addEventListener("input", (e) => {
  setLayerOpacity(map, "fieldsurvey-badge-outer", Number(e.target.value), "circle-opacity");
  setLayerOpacity(map, "fieldsurvey-badge-inner", Number(e.target.value), "circle-opacity");
});
document.getElementById("btn-open-new-survey").addEventListener("click", () => {
  const center = map.getCenter();
  openSurveyForm({ targetDataset: "new", targetId: null, targetName: "", lngLat: center });
});
document.getElementById("btn-clear-survey-drafts").addEventListener("click", () => {
  const count = fieldSurveyStore.getDrafts().length;
  if (count === 0) {
    window.alert("削除する下書きはありません。");
    return;
  }
  if (window.confirm(`下書き${count}件をこの端末から全て消去します。エクスポート済み（GeoJSONダウンロード＆commit/push済み）であることを確認してから実行してください。よろしいですか？`)) {
    fieldSurveyStore.clearDrafts();
    refreshFieldSurveyLayer();
  }
});

// ============================================================
// 現地調査記録フォーム（モーダル）の配線
// ============================================================
const surveyFormOverlay = document.getElementById("survey-form-overlay");
const surveyForm = document.getElementById("survey-form");

/** フォームを開き、対象地点の情報（あれば）で初期値を埋める */
function openSurveyForm({ targetDataset, targetId, targetName, lngLat }) {
  document.getElementById("survey-target-dataset").value = targetDataset;
  document.getElementById("survey-target-id").value = targetId || "";
  document.getElementById("survey-target-name").value = targetName || "";
  document.getElementById("survey-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("survey-status").value = "湧出中";
  document.getElementById("survey-lng").value = lngLat.lng.toFixed(6);
  document.getElementById("survey-lat").value = lngLat.lat.toFixed(6);
  document.getElementById("survey-address-note").value = "";
  document.getElementById("survey-surveyor").value = "";
  document.getElementById("survey-notes").value = "";
  document.getElementById("survey-photo-url").value = "";
  document.getElementById("survey-form-title").textContent =
    targetDataset === "new" ? "現地調査を記録（新規地点）" : `現地調査を記録: ${targetName}`;
  surveyFormOverlay.classList.remove("hidden");
  document.getElementById("survey-target-name").focus();
}

function closeSurveyForm() {
  surveyFormOverlay.classList.add("hidden");
}

document.getElementById("survey-form-close").addEventListener("click", closeSurveyForm);
document.getElementById("survey-form-cancel").addEventListener("click", closeSurveyForm);
// 背景（オーバーレイ自身）をクリックしたときだけ閉じる。ダイアログ内のクリックでは閉じない。
surveyFormOverlay.addEventListener("click", (e) => {
  if (e.target === surveyFormOverlay) closeSurveyForm();
});

// GPSで現在地を取得し、経度・緯度欄に反映する（現地でGPS精度の位置を記録したいときに使う）
document.getElementById("survey-use-gps").addEventListener("click", () => {
  if (!navigator.geolocation) {
    window.alert("この端末・ブラウザでは位置情報を取得できません。手入力してください。");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById("survey-lng").value = pos.coords.longitude.toFixed(6);
      document.getElementById("survey-lat").value = pos.coords.latitude.toFixed(6);
    },
    (err) => window.alert("現在地の取得に失敗しました: " + err.message),
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

surveyForm.addEventListener("submit", (e) => {
  e.preventDefault();
  fieldSurveyStore.addDraft({
    targetDataset: document.getElementById("survey-target-dataset").value || "new",
    targetId: document.getElementById("survey-target-id").value || null,
    targetName: document.getElementById("survey-target-name").value.trim(),
    lng: Number(document.getElementById("survey-lng").value),
    lat: Number(document.getElementById("survey-lat").value),
    status: document.getElementById("survey-status").value,
    surveyedAt: document.getElementById("survey-date").value,
    surveyor: document.getElementById("survey-surveyor").value.trim(),
    addressNote: document.getElementById("survey-address-note").value.trim(),
    notes: document.getElementById("survey-notes").value.trim(),
    photoUrl: document.getElementById("survey-photo-url").value.trim()
  });
  refreshFieldSurveyLayer();
  closeSurveyForm();
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
    // タブを切り替えたら、別データセットの選択状態（強調表示・ポップアップ・スコア内訳パネル）を消す
    setHighlight(map, null);
    clearTableSelectionPopups();
    document.getElementById("info-panel").classList.add("hidden");
    document.getElementById("fieldsurvey-export-note").classList.toggle("hidden", state.activeTab !== "fieldsurvey");
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
  const filenames = {
    springs: "springs.csv",
    potential: "potential_grid.csv",
    wetland1997: "wetland_1997.csv",
    fieldsurvey: "field_survey.csv"
  };
  downloadCSV(columns, rows, filenames[state.activeTab]);
});

// ---- GeoJSONダウンロード ----
// springs/potential/wetland1997タブ: 現在の地図表示範囲×フィルタ条件に合致するデータを出力
// fieldsurveyタブ: data/field_survey.geojson をそのまま置き換えられるよう、表示範囲に関わらず全件を出力
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
  } else if (state.activeTab === "wetland1997") {
    const features = filteredWetlandFeatures().filter((f) => bounds.contains(f.geometry.coordinates));
    downloadGeoJSON({ type: "FeatureCollection", features }, "wetland_1997_export.geojson");
  } else {
    downloadGeoJSON(getCombinedFieldSurveyData(), "field_survey.geojson");
  }
});
