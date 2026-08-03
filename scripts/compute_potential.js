/**
 * compute_potential.js
 *
 * 湧水ポテンシャルスコア算出パイプラインの実装（Node.js版）。
 * このPCにはPython実行環境が無かったため、他のデータ取得スクリプト
 * （geocode_springs.js 等）と同じくNode.jsで実装している。
 * compute_potential.py はパイプラインの設計意図を示す雛形として残しているので、
 * 各指標の考え方はそちらのコメントもあわせて参照してほしい。
 *
 * 事前に以下を実行しておくこと:
 *   node fetch_dem.js                  -> scripts/raw/dem_grid.json / dem_grid.bin
 *   node extract_geology_boundary.js   -> data/geology_boundary.geojson
 *
 * 処理の流れ:
 *   1. DEMグリッドを読み込み、hydrology.js で 傾斜・曲率・D8流向・集水セル数・TWI・HAND を計算
 *   2. 出力用の250mグリッド（既存ダミー版と同じ範囲・粒度）の各セルについて、
 *      対応するDEM高解像度ピクセル群の平均値でTWI/HAND/曲率を集約
 *   3. 地質境界線（data/geology_boundary.geojson）までの最短距離を各セル中心で計算
 *   4. 既知湧水地点（data/springs.geojson）のガウスカーネル密度を各セル中心で計算
 *   5. 各指標をmin-max正規化（HAND・地質境界距離は値が小さいほど湧水しやすいため反転）し、
 *      重み付け加重和でスコアを算出
 *   6. data/potential_grid.geojson に出力（既存ダミー版とプロパティ形式・グリッド範囲を統一）
 *
 * 使い方:
 *   cd web/scripts
 *   node compute_potential.js
 */

const fs = require("fs");
const path = require("path");
const hydro = require("./hydrology.js");
const { lngLatToTileXY } = require("./dem_tiles.js");

// ============================================================
// 設定（重み・グリッド範囲・パラメータ）
// ============================================================

// 各指標の重み。compute_potential.py の Weights と同じ値にしてある。合計1になるよう正規化して使う。
const RAW_WEIGHTS = { twi: 0.3, hand: 0.3, curvature: 0.15, geoBoundary: 0.15, springKde: 0.1 };
const WEIGHT_SUM = Object.values(RAW_WEIGHTS).reduce((a, b) => a + b, 0);
const WEIGHTS = Object.fromEntries(Object.entries(RAW_WEIGHTS).map(([k, v]) => [k, v / WEIGHT_SUM]));

// 出力グリッド: 既存のダミー版 data/potential_grid.geojson と同じ範囲・粒度に揃える
const OUTPUT_GRID = { west: 139.0425, south: 35.9225, north: 36.0375, cellSizeDeg: 0.0025, nx: 46, ny: 46 };

const STREAM_THRESHOLD_CELLS = 300; // 集水300セル(約7.7m格子)以上を「水路」とみなす
const KDE_BANDWIDTH_M = 500; // 既知湧水地点カーネル密度のバンド幅

const RAW_DIR = path.join(__dirname, "raw");
const GEOLOGY_PATH = path.join(__dirname, "../data/geology_boundary.geojson");
const SPRINGS_PATH = path.join(__dirname, "../data/springs.geojson");
const OUTPUT_PATH = path.join(__dirname, "../data/potential_grid.geojson");

const ZOOM = 14; // fetch_dem.js と揃える

// ============================================================
// ユーティリティ
// ============================================================

function minMaxNormalize(values, invert = false) {
  const valid = values.filter((v) => !Number.isNaN(v));
  const lo = Math.min(...valid);
  const hi = Math.max(...valid);
  return values.map((v) => {
    if (Number.isNaN(v)) return NaN;
    const n = hi - lo < 1e-9 ? 0 : (v - lo) / (hi - lo);
    return invert ? 1 - n : n;
  });
}

/** NaNのセルを、有効な値の平均で埋める（DEM欠測等で稀に発生するアウトプットセルの穴埋め） */
function fillNaNWithMean(values) {
  const valid = values.filter((v) => !Number.isNaN(v));
  const mean = valid.reduce((a, b) => a + b, 0) / valid.length;
  return values.map((v) => (Number.isNaN(v) ? mean : v));
}

// 局所的な等距円筒近似（この程度の範囲・緯度なら十分な精度）でメートル距離を測るためのスケール
function makeLocalMeters(centerLatDeg) {
  const mPerDegLat = 110574; // 緯度1度あたりのおおよそのメートル数
  const mPerDegLng = 111320 * Math.cos((centerLatDeg * Math.PI) / 180);
  return {
    toMeters(lng1, lat1, lng2, lat2) {
      const dx = (lng2 - lng1) * mPerDegLng;
      const dy = (lat2 - lat1) * mPerDegLat;
      return Math.sqrt(dx * dx + dy * dy);
    }
  };
}

/** 点(px,py)から線分(ax,ay)-(bx,by)までの最短距離（同じ単位系で） */
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const apx = px - ax, apy = py - ay;
  const abLenSq = abx * abx + aby * aby;
  let t = abLenSq < 1e-12 ? 0 : (apx * abx + apy * aby) / abLenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * abx, cy = ay + t * aby;
  const dx = px - cx, dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

// ============================================================
// 1. DEM読み込み & 地形指標計算
// ============================================================

function loadDem() {
  const meta = JSON.parse(fs.readFileSync(path.join(RAW_DIR, "dem_grid.json"), "utf8"));
  const buf = fs.readFileSync(path.join(RAW_DIR, meta.binFile));
  const elevations = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
  return { ...meta, elevations };
}

/** DEMグリッド上でのピクセル座標(小数)を求める（fetch_dem.js/dem_tiles.js と同じ計算方法） */
function makePixelLocator(dem) {
  const [westTileXF] = lngLatToTileXY(dem.west, dem.north, ZOOM);
  const [, northTileYF] = lngLatToTileXY(dem.west, dem.north, ZOOM);
  const westTileX = Math.floor(westTileXF);
  const northTileY = Math.floor(northTileYF);
  return function lngLatToPixel(lng, lat) {
    const [txF, tyF] = lngLatToTileXY(lng, lat, ZOOM);
    return [(txF - westTileX) * 256, (tyF - northTileY) * 256];
  };
}

function computeTerrainRasters(dem) {
  console.log("地形指標を計算中（傾斜・曲率・流向・集水面積・TWI・HAND）...");
  const filled = hydro.fillMissing(dem.elevations, dem.width, dem.height);
  const noSinks = hydro.fillDepressions(filled, dem.width, dem.height);
  const { slope, curvature } = hydro.computeSlopeAndCurvature(noSinks, dem.width, dem.height, dem.metersPerPixel);
  const downstream = hydro.computeFlowDirection(noSinks, dem.width, dem.height, dem.metersPerPixel);
  const { flowAcc, elevationDescOrder } = hydro.computeFlowAccumulation(noSinks, downstream, dem.width, dem.height);
  const twi = hydro.computeTWI(flowAcc, slope, dem.width, dem.height, dem.metersPerPixel);
  const { hand } = hydro.computeHAND(noSinks, downstream, flowAcc, elevationDescOrder, STREAM_THRESHOLD_CELLS, dem.width, dem.height);
  return { twi, hand, curvature };
}

/** 出力セルの範囲内にあるDEMピクセルの平均値を返す（該当ピクセルが無ければNaN） */
function aggregateCell(raster, dem, lngLatToPixel, lng0, lat0, lng1, lat1, useAbs = false) {
  const [c0, r1] = lngLatToPixel(lng0, lat0); // 南西
  const [c1, r0] = lngLatToPixel(lng1, lat1); // 北東（緯度が大きいほどrowは小さい）
  const colStart = Math.max(0, Math.floor(Math.min(c0, c1)));
  const colEnd = Math.min(dem.width, Math.ceil(Math.max(c0, c1)));
  const rowStart = Math.max(0, Math.floor(Math.min(r0, r1)));
  const rowEnd = Math.min(dem.height, Math.ceil(Math.max(r0, r1)));

  let sum = 0, count = 0;
  for (let row = rowStart; row < rowEnd; row++) {
    for (let col = colStart; col < colEnd; col++) {
      const v = raster[row * dem.width + col];
      if (!Number.isNaN(v)) { sum += useAbs ? Math.abs(v) : v; count++; }
    }
  }
  return count > 0 ? sum / count : NaN;
}

// ============================================================
// 2. 地質境界距離
// ============================================================

function computeGeologyDistances(cellCenters) {
  const geology = JSON.parse(fs.readFileSync(GEOLOGY_PATH, "utf8"));
  // 全セグメントを事前に平坦なリストにしておく（[lng1,lat1,lng2,lat2]の配列）
  const segments = [];
  geology.features.forEach((f) => {
    f.geometry.coordinates.forEach((part) => {
      for (let i = 0; i < part.length - 1; i++) {
        segments.push([part[i][0], part[i][1], part[i + 1][0], part[i + 1][1]]);
      }
    });
  });
  console.log(`地質境界セグメント数: ${segments.length}`);

  return cellCenters.map(([lng, lat]) => {
    let minDist = Infinity;
    for (const [ax, ay, bx, by] of segments) {
      // セル中心を原点としたローカル平面（等距円筒近似）に投影してから最短距離を計算する
      const segAX = (ax - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
      const segAY = (ay - lat) * 110574;
      const segBX = (bx - lng) * 111320 * Math.cos((lat * Math.PI) / 180);
      const segBY = (by - lat) * 110574;
      const d = pointToSegmentDistance(0, 0, segAX, segAY, segBX, segBY);
      if (d < minDist) minDist = d;
    }
    return minDist;
  });
}

// ============================================================
// 3. 既知湧水地点カーネル密度(KDE)
// ============================================================

function computeSpringKde(cellCenters, localMeters) {
  const springs = JSON.parse(fs.readFileSync(SPRINGS_PATH, "utf8"));
  const points = springs.features.map((f) => f.geometry.coordinates);

  return cellCenters.map(([lng, lat]) => {
    let sum = 0;
    for (const [slng, slat] of points) {
      const d = localMeters.toMeters(lng, lat, slng, slat);
      sum += Math.exp(-0.5 * (d / KDE_BANDWIDTH_M) ** 2);
    }
    return sum;
  });
}

// ============================================================
// メイン処理
// ============================================================

async function main() {
  const dem = loadDem();
  const lngLatToPixel = makePixelLocator(dem);
  const { twi, hand, curvature } = computeTerrainRasters(dem);

  // 出力グリッドのセル情報（既存ダミー版と同じ命名: g_{ix}_{iy}）を組み立てる
  const cells = [];
  for (let iy = 0; iy < OUTPUT_GRID.ny; iy++) {
    for (let ix = 0; ix < OUTPUT_GRID.nx; ix++) {
      const lng0 = OUTPUT_GRID.west + ix * OUTPUT_GRID.cellSizeDeg;
      const lat0 = OUTPUT_GRID.south + iy * OUTPUT_GRID.cellSizeDeg;
      const lng1 = lng0 + OUTPUT_GRID.cellSizeDeg;
      const lat1 = lat0 + OUTPUT_GRID.cellSizeDeg;
      cells.push({ cellId: `g_${ix}_${iy}`, lng0, lat0, lng1, lat1, centerLng: (lng0 + lng1) / 2, centerLat: (lat0 + lat1) / 2 });
    }
  }

  console.log(`出力グリッド: ${cells.length}セル。DEMラスターを250mセルへ集約中...`);
  const twiValues = cells.map((c) => aggregateCell(twi, dem, lngLatToPixel, c.lng0, c.lat0, c.lng1, c.lat1));
  const handValues = cells.map((c) => aggregateCell(hand, dem, lngLatToPixel, c.lng0, c.lat0, c.lng1, c.lat1));
  const curvatureRaw = cells.map((c) => aggregateCell(curvature, dem, lngLatToPixel, c.lng0, c.lat0, c.lng1, c.lat1));
  const curvatureAbs = cells.map((c) => aggregateCell(curvature, dem, lngLatToPixel, c.lng0, c.lat0, c.lng1, c.lat1, true));

  const centerLatOfArea = (OUTPUT_GRID.south + OUTPUT_GRID.cellSizeDeg * OUTPUT_GRID.ny / 2);
  const localMeters = makeLocalMeters(centerLatOfArea);
  const cellCenters = cells.map((c) => [c.centerLng, c.centerLat]);

  console.log("地質境界距離を計算中...");
  const distToBoundary = computeGeologyDistances(cellCenters);

  console.log("既知湧水地点のカーネル密度を計算中...");
  const springKde = computeSpringKde(cellCenters, localMeters);

  // ---- 正規化（HAND・地質境界距離は値が小さいほど湧水しやすいため反転） ----
  const twiFilled = fillNaNWithMean(twiValues);
  const handFilled = fillNaNWithMean(handValues);
  const curvatureAbsFilled = fillNaNWithMean(curvatureAbs);

  const twiNorm = minMaxNormalize(twiFilled, false);
  const handNorm = minMaxNormalize(handFilled, true);
  const curvatureNorm = minMaxNormalize(curvatureAbsFilled, false);
  const boundaryNorm = minMaxNormalize(distToBoundary, true);
  const kdeNorm = minMaxNormalize(springKde, false);

  const features = cells.map((c, i) => {
    const score =
      WEIGHTS.twi * twiNorm[i] +
      WEIGHTS.hand * handNorm[i] +
      WEIGHTS.curvature * curvatureNorm[i] +
      WEIGHTS.geoBoundary * boundaryNorm[i] +
      WEIGHTS.springKde * kdeNorm[i];

    return {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[
          [c.lng0, c.lat0], [c.lng1, c.lat0], [c.lng1, c.lat1], [c.lng0, c.lat1], [c.lng0, c.lat0]
        ].map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))])]
      },
      properties: {
        cell_id: c.cellId,
        score: Number(score.toFixed(3)),
        twi: Number(twiFilled[i].toFixed(2)),
        hand: Number(handFilled[i].toFixed(1)),
        dist_to_boundary: Number(distToBoundary[i].toFixed(0)),
        curvature: Number(curvatureRaw[i].toFixed(4)),
        spring_kde: Number(kdeNorm[i].toFixed(3))
      }
    };
  });

  const geojson = { type: "FeatureCollection", features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson));
  console.log(`保存しました: ${OUTPUT_PATH}（${features.length}セル）`);

  const scores = features.map((f) => f.properties.score);
  console.log(`score範囲: ${Math.min(...scores).toFixed(3)} 〜 ${Math.max(...scores).toFixed(3)}, 平均: ${(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(3)}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
