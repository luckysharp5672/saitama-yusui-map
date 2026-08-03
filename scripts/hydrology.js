/**
 * hydrology.js
 *
 * DEM（標高グリッド）から、湧水ポテンシャルスコアの算出に必要な地形指標を計算する
 * 純粋な数値計算モジュール（外部ライブラリ非依存）。fetch/ファイルI/Oは行わない。
 *
 * 実装している指標:
 *   - 傾斜（slope, ラジアン） / 曲率（curvature, ラプラシアン近似）
 *   - D8流下方向・集水セル数（フローアキュムレーション）
 *   - TWI（地形湿潤指数）= ln( 集水面積 / tan(傾斜) )
 *   - HAND（Height Above Nearest Drainage） = 標高 - 最寄り水路（流下経路上）の標高
 *
 * 全て「標高グリッド全体を1次元配列として扱い、セルインデックス = row*width+col」で統一している。
 */

/** NaN（欠測）セルを近傍の有効値の平均で埋める。数回の反復で収束させる。 */
function fillMissing(elevations, width, height, maxIterations = 8) {
  const filled = Float64Array.from(elevations);
  for (let iter = 0; iter < maxIterations; iter++) {
    let remaining = 0;
    const next = Float64Array.from(filled);
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        if (!Number.isNaN(filled[idx])) continue;
        let sum = 0, count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const r = row + dr, c = col + dc;
            if (r < 0 || r >= height || c < 0 || c >= width) continue;
            const v = filled[r * width + c];
            if (!Number.isNaN(v)) { sum += v; count++; }
          }
        }
        if (count > 0) next[idx] = sum / count;
        else remaining++;
      }
    }
    filled.set(next);
    if (remaining === 0) break;
  }
  return filled;
}

/**
 * 窪地（周囲より低いセル）を、下流へ抜けられるようごく僅かに底上げして埋める簡易版。
 * 本格的なpriority-flood法ではないが、5mメッシュの小規模エリアであれば十分実用的。
 */
function fillDepressions(elevations, width, height, maxIterations = 50) {
  const filled = Float64Array.from(elevations);
  const EPS = 0.01; // 1cm刻みで底上げ
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = 0;
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        const z = filled[idx];
        if (Number.isNaN(z)) continue;
        let minNeighbor = Infinity;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (dr === 0 && dc === 0) continue;
            const r = row + dr, c = col + dc;
            if (r < 0 || r >= height || c < 0 || c >= width) { minNeighbor = -Infinity; continue; } // 端は出口とみなす
            const v = filled[r * width + c];
            if (!Number.isNaN(v)) minNeighbor = Math.min(minNeighbor, v);
          }
        }
        if (minNeighbor > z && minNeighbor !== Infinity && minNeighbor !== -Infinity) {
          filled[idx] = minNeighbor + EPS;
          changed++;
        }
      }
    }
    if (changed === 0) break;
  }
  return filled;
}

/** Horn法による傾斜（ラジアン）と、ラプラシアン近似による曲率を計算する */
function computeSlopeAndCurvature(elevations, width, height, cellSize) {
  const slope = new Float64Array(width * height).fill(NaN);
  const curvature = new Float64Array(width * height).fill(NaN);

  const at = (row, col) => elevations[Math.min(height - 1, Math.max(0, row)) * width + Math.min(width - 1, Math.max(0, col))];

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const a = at(row - 1, col - 1), b = at(row - 1, col), c = at(row - 1, col + 1);
      const d = at(row, col - 1), e = at(row, col), f = at(row, col + 1);
      const g = at(row + 1, col - 1), h = at(row + 1, col), i = at(row + 1, col + 1);
      if ([a, b, c, d, e, f, g, h, i].some(Number.isNaN)) continue;

      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * cellSize);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * cellSize);
      slope[idx] = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));

      // ラプラシアン（4近傍和 - 4*中心）/ セルサイズ^2: 正=谷(集水), 負=尾根(発散)
      curvature[idx] = (b + d + f + h - 4 * e) / (cellSize * cellSize);
    }
  }
  return { slope, curvature };
}

// D8: 8方向のオフセット（インデックス0-7）
const D8_OFFSETS = [
  [-1, 0], [-1, 1], [0, 1], [1, 1],
  [1, 0], [1, -1], [0, -1], [-1, -1]
];
const D8_DIST_FACTOR = [1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * D8法（最急降下方向）で各セルの流下先セルインデックスを求める。
 * 流下先が無い（周囲より低い＝窪地の底、または端）セルは downstream=-1 とする。
 * fillDepressions() を先にかけておくことで、窪地起因の -1 はほぼ端セルのみになる想定。
 */
function computeFlowDirection(elevations, width, height, cellSize) {
  const downstream = new Int32Array(width * height).fill(-1);

  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const z = elevations[idx];
      if (Number.isNaN(z)) continue;

      let bestSlope = 0;
      let bestIdx = -1;
      for (let dir = 0; dir < 8; dir++) {
        const [dr, dc] = D8_OFFSETS[dir];
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= height || c < 0 || c >= width) continue;
        const nIdx = r * width + c;
        const nz = elevations[nIdx];
        if (Number.isNaN(nz)) continue;
        const dist = cellSize * D8_DIST_FACTOR[dir];
        const dropSlope = (z - nz) / dist;
        if (dropSlope > bestSlope) {
          bestSlope = dropSlope;
          bestIdx = nIdx;
        }
      }
      downstream[idx] = bestIdx;
    }
  }
  return downstream;
}

/** 標高降順に処理することで、集水セル数（フローアキュムレーション）を1パスで計算する */
function computeFlowAccumulation(elevations, downstream, width, height) {
  const n = width * height;
  const order = [];
  for (let i = 0; i < n; i++) if (!Number.isNaN(elevations[i])) order.push(i);
  order.sort((a, b) => elevations[b] - elevations[a]); // 標高が高い順

  const flowAcc = new Float64Array(n).fill(NaN);
  for (const i of order) flowAcc[i] = 1; // 自セル分
  for (const i of order) {
    const d = downstream[i];
    if (d >= 0) flowAcc[d] += flowAcc[i];
  }
  return { flowAcc, elevationDescOrder: order };
}

/** TWI = ln( 集水面積[m^2] / tan(傾斜) )。傾斜0付近は下限でクランプしてln(0)/発散を防ぐ。 */
function computeTWI(flowAcc, slope, width, height, cellSize) {
  const twi = new Float64Array(width * height).fill(NaN);
  const MIN_SLOPE_RAD = 0.001; // 約0.06度。平坦地での発散を防ぐ下限
  for (let i = 0; i < width * height; i++) {
    if (Number.isNaN(flowAcc[i]) || Number.isNaN(slope[i])) continue;
    const catchmentArea = flowAcc[i] * cellSize * cellSize;
    const tanSlope = Math.max(Math.tan(slope[i]), Math.tan(MIN_SLOPE_RAD));
    twi[i] = Math.log(catchmentArea / tanSlope);
  }
  return twi;
}

/**
 * HAND（Height Above Nearest Drainage）を計算する。
 * flowAcc >= streamThreshold のセルを「水路」とみなし、標高昇順に処理することで
 * 各セルの流下経路上にある最寄り水路の標高（streamElev）を伝播させる。
 */
function computeHAND(elevations, downstream, flowAcc, elevationDescOrder, streamThreshold, width, height) {
  const n = width * height;
  const streamElev = new Float64Array(n).fill(NaN);
  const isStream = new Uint8Array(n);

  // 標高「昇順」= elevationDescOrder の逆順で処理する
  for (let k = elevationDescOrder.length - 1; k >= 0; k--) {
    const i = elevationDescOrder[k];
    if (flowAcc[i] >= streamThreshold) {
      isStream[i] = 1;
      streamElev[i] = elevations[i];
    } else {
      const d = downstream[i];
      streamElev[i] = d >= 0 ? streamElev[d] : NaN; // 端まで水路に届かなかった場合はNaN
    }
  }

  const hand = new Float64Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(elevations[i]) && !Number.isNaN(streamElev[i])) {
      hand[i] = Math.max(0, elevations[i] - streamElev[i]);
    }
  }
  return { hand, isStream };
}

module.exports = {
  fillMissing,
  fillDepressions,
  computeSlopeAndCurvature,
  computeFlowDirection,
  computeFlowAccumulation,
  computeTWI,
  computeHAND
};
