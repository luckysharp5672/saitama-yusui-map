/**
 * shapefile_reader.js
 * ESRI Shapefile (.shp) を依存パッケージ無しでパースする最小限のリーダー。
 * PolyLine(3) / Polygon(5) と、そのZ付き(13/15)・M付き(23/25)版に対応
 * （Z/M値は湧水ポテンシャル計算では使わないため読み飛ばす）。
 *
 * 参考: ESRI Shapefile Technical Description (whitepaper.pdf)
 *   ファイルヘッダ: 100バイト（ビッグエンディアン主体、一部リトルエンディアン）
 *   レコード: [レコード番号(4B BE), コンテンツ長(4B BE, 16bit語単位)] + [シェイプタイプ(4B LE) + 座標データ]
 */

const SHAPE_TYPE_POLYLINE = [3, 13, 23];
const SHAPE_TYPE_POLYGON = [5, 15, 25];

function boxesIntersect(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

/**
 * .shp ファイルのBufferをパースし、フィーチャ配列を返す。
 * 各フィーチャ: { shapeType, parts: [[ [x,y], [x,y], ... ], ...] }
 * parts は「線分/リングの配列」。PolyLineなら各要素が1本の折れ線、Polygonなら1つの環。
 *
 * @param {object} [bboxFilter] - {minX,minY,maxX,maxY} を指定すると、レコード自身の
 *   バウンディングボックスがこの範囲と重ならないレコードは座標を読まずスキップする
 *   （全国データから対象エリアだけ拾う際、無駄なパースを避けて高速化するため）。
 */
function parseShapefile(buffer, bboxFilter = null) {
  const fileShapeType = buffer.readInt32LE(32);
  const features = [];
  let offset = 100; // ファイルヘッダの後ろから

  while (offset < buffer.length) {
    const contentLengthWords = buffer.readInt32BE(offset + 4);
    const contentByteLength = contentLengthWords * 2;
    const recordStart = offset + 8;
    const shapeType = buffer.readInt32LE(recordStart);

    if (shapeType === 0) {
      // Null shape: 座標データ無し（フィルタ時は追加しない）
      if (!bboxFilter) features.push({ shapeType, parts: [] });
    } else if (SHAPE_TYPE_POLYLINE.includes(shapeType) || SHAPE_TYPE_POLYGON.includes(shapeType)) {
      const boxStart = recordStart + 4;
      const minX = buffer.readDoubleLE(boxStart);
      const minY = buffer.readDoubleLE(boxStart + 8);
      const maxX = buffer.readDoubleLE(boxStart + 16);
      const maxY = buffer.readDoubleLE(boxStart + 24);

      const skip = bboxFilter && !boxesIntersect(minX, minY, maxX, maxY, bboxFilter.minX, bboxFilter.minY, bboxFilter.maxX, bboxFilter.maxY);
      if (!skip) {
        let p = recordStart + 4 + 32; // shapeType(4) + Box(32=4 doubles)
        const numParts = buffer.readInt32LE(p); p += 4;
        const numPoints = buffer.readInt32LE(p); p += 4;
        const partStartIndices = [];
        for (let i = 0; i < numParts; i++) { partStartIndices.push(buffer.readInt32LE(p)); p += 4; }

        const allPoints = new Array(numPoints);
        for (let i = 0; i < numPoints; i++) {
          const x = buffer.readDoubleLE(p); p += 8;
          const y = buffer.readDoubleLE(p); p += 8;
          allPoints[i] = [x, y];
        }
        // Z/M配列が後ろに続くが、境界距離計算には使わないため読み飛ばす（次レコードはoffset側で管理）

        const parts = partStartIndices.map((start, i) => {
          const end = i + 1 < partStartIndices.length ? partStartIndices[i + 1] : numPoints;
          return allPoints.slice(start, end);
        });
        features.push({ shapeType, parts, box: { minX, minY, maxX, maxY } });
      }
    }
    // Point/MultiPoint等、今回は使わない形状はスキップ（bboxFilter有無に関わらず追加しない）

    offset = recordStart + contentByteLength;
  }

  return { fileShapeType, features };
}

module.exports = { parseShapefile };
