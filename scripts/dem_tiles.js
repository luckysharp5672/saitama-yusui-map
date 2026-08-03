/**
 * dem_tiles.js
 *
 * 国土地理院の標高タイル（DEM5A: 5mメッシュ、精密標高基盤）を取得し、
 * 対象エリア（横瀬町・秩父地域）を覆う1枚の標高グリッド（メッシュ配列）に
 * 合成するための共通モジュール。fetch_dem.js から呼び出して使う。
 *
 * タイル仕様（国土地理院 地理院タイル）:
 *   https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt
 *   1タイル = 256×256セルのCSV（カンマ区切り、欠測値は "e"）。
 *   タイル座標系は標準スリッピータイル（Web Mercator）。
 */

const DEM_TILE_URL = "https://cyberjapandata.gsi.go.jp/xyz/dem5a/{z}/{x}/{y}.txt";
const TILE_SIZE = 256;

/** 経度・緯度からタイル座標（小数含む）を計算する標準式 */
function lngLatToTileXY(lng, lat, z) {
  const n = 2 ** z;
  const x = ((lng + 180) / 360) * n;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return [x, y];
}

/** タイル座標（小数可）から経度・緯度を逆算する標準式（ピクセル単位の位置決めに使う） */
function tileXYToLngLat(x, y, z) {
  const n = 2 ** z;
  const lng = (x / n) * 360 - 180;
  const latRad = Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n)));
  const lat = (latRad * 180) / Math.PI;
  return [lng, lat];
}

/** 1タイル分のDEMテキストを取得し、256x256のFloat64Array（欠測はNaN）にパースする */
async function fetchDemTile(z, x, y) {
  const url = DEM_TILE_URL.replace("{z}", z).replace("{x}", x).replace("{y}", y);
  const res = await fetch(url);
  if (!res.ok) return null; // このタイルにはデータが無い（海・範囲外等）
  const text = await res.text();
  const rows = text.trim().split("\n");
  const grid = new Float64Array(TILE_SIZE * TILE_SIZE).fill(NaN);
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r].split(",");
    for (let c = 0; c < cells.length; c++) {
      const v = cells[c].trim();
      if (v !== "e" && v !== "") grid[r * TILE_SIZE + c] = parseFloat(v);
    }
  }
  return grid;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 指定した緯度経度の範囲（バッファ込み）を覆うDEMタイルを全て取得し、
 * 1枚の大きな標高グリッドに合成する。
 *
 * @returns {{
 *   width: number, height: number, elevations: Float64Array,
 *   west: number, north: number, metersPerPixel: number,
 *   lngLatOfPixel: (col: number, row: number) => [number, number]
 * }}
 */
async function fetchAndMosaicDem({ west, south, east, north, zoom = 14, concurrency = 6 }) {
  const [xMinF, yMinF] = lngLatToTileXY(west, north, zoom); // 北西
  const [xMaxF, yMaxF] = lngLatToTileXY(east, south, zoom); // 南東
  const xMin = Math.floor(xMinF);
  const xMax = Math.floor(xMaxF);
  const yMin = Math.floor(yMinF);
  const yMax = Math.floor(yMaxF);
  const tilesX = xMax - xMin + 1;
  const tilesY = yMax - yMin + 1;

  console.log(`DEMタイル取得: z=${zoom}, x=${xMin}-${xMax}, y=${yMin}-${yMax}（${tilesX * tilesY}枚）`);

  const width = tilesX * TILE_SIZE;
  const height = tilesY * TILE_SIZE;
  const elevations = new Float64Array(width * height).fill(NaN);

  // タイル取得タスクの一覧を作り、concurrency件ずつ並列で処理する（GSIサーバーへの配慮）
  const tasks = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      tasks.push({ tx, ty, x: xMin + tx, y: yMin + ty });
    }
  }

  let done = 0;
  async function worker() {
    while (tasks.length > 0) {
      const task = tasks.shift();
      const grid = await fetchDemTile(zoom, task.x, task.y);
      if (grid) {
        for (let r = 0; r < TILE_SIZE; r++) {
          const destRow = task.ty * TILE_SIZE + r;
          const destOffset = destRow * width + task.tx * TILE_SIZE;
          elevations.set(grid.subarray(r * TILE_SIZE, (r + 1) * TILE_SIZE), destOffset);
        }
      }
      done++;
      if (done % 10 === 0) console.log(`  ${done}/${tilesX * tilesY} タイル取得済み`);
      await sleep(30); // 連続アクセスを避けるための小休止
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  // 緯度方向のメートル/ピクセル（Web Mercatorの縮尺式）。対象範囲が狭いため中心緯度で代表させる。
  const centerLat = (north + south) / 2;
  const metersPerPixel = (156543.03392 * Math.cos((centerLat * Math.PI) / 180)) / 2 ** zoom;

  function lngLatOfPixel(col, row) {
    return tileXYToLngLat(xMin + col / TILE_SIZE, yMin + row / TILE_SIZE, zoom);
  }

  const [westActual] = tileXYToLngLat(xMin, 0, zoom);
  const [, northActual] = tileXYToLngLat(0, yMin, zoom);

  return { width, height, elevations, west: westActual, north: northActual, metersPerPixel, lngLatOfPixel };
}

module.exports = { fetchAndMosaicDem, lngLatToTileXY, tileXYToLngLat };
