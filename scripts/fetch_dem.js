/**
 * fetch_dem.js
 *
 * 対象エリア（横瀬町・秩父地域、既存の potential_grid.geojson と同じ範囲）を覆う
 * 国土地理院DEM5A（5mメッシュ）タイルを取得し、1枚の標高グリッドとして
 * scripts/raw/dem_grid.json に保存する。
 *
 * 出力ファイルは重いため .gitignore 対象（raw/ ディレクトリ）。
 * compute_potential.js から読み込んで指標計算に使う。
 *
 * 使い方:
 *   cd web/scripts
 *   node fetch_dem.js
 */

const fs = require("fs");
const path = require("path");
const { fetchAndMosaicDem } = require("./dem_tiles.js");

// 対象エリア: 既存の data/potential_grid.geojson と同じ範囲に、
// 流向・集水面積計算の境界誤差を減らすためのバッファ(0.01度、約1km)を加える
const BBOX = { west: 139.0425 - 0.01, south: 35.9225 - 0.01, east: 139.1575 + 0.01, north: 36.0375 + 0.01 };

const OUTPUT_DIR = path.join(__dirname, "raw");
const OUTPUT_PATH = path.join(OUTPUT_DIR, "dem_grid.json");
const OUTPUT_BIN_PATH = path.join(OUTPUT_DIR, "dem_grid.bin");

async function main() {
  const dem = await fetchAndMosaicDem({ ...BBOX, zoom: 14 });

  const validCount = dem.elevations.reduce((acc, v) => acc + (Number.isNaN(v) ? 0 : 1), 0);
  console.log(
    `合成グリッド: ${dem.width} x ${dem.height} = ${dem.width * dem.height}セル ` +
    `（有効値 ${validCount}件, 欠測 ${dem.width * dem.height - validCount}件）, ` +
    `metersPerPixel=${dem.metersPerPixel.toFixed(3)}`
  );

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // 標高値は容量の大きいバイナリ(Float64)、それ以外のメタ情報はJSONで分けて保存する
  fs.writeFileSync(OUTPUT_BIN_PATH, Buffer.from(dem.elevations.buffer));
  fs.writeFileSync(
    OUTPUT_PATH,
    JSON.stringify(
      {
        width: dem.width,
        height: dem.height,
        west: dem.west,
        north: dem.north,
        metersPerPixel: dem.metersPerPixel,
        binFile: path.basename(OUTPUT_BIN_PATH)
      },
      null,
      2
    )
  );

  console.log(`保存しました: ${OUTPUT_PATH}`);
  console.log(`保存しました: ${OUTPUT_BIN_PATH}`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
