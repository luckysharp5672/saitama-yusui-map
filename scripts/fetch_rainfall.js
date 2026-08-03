/**
 * fetch_rainfall.js
 *
 * 気象庁「過去の気象データ・検索」（https://www.data.jma.go.jp/obd/stats/etrn/）から、
 * 対象エリア（横瀬町・秩父地域）周辺のアメダス観測所の日降水量を取得し、
 * data/rainfall_weekly.json（既存ダミー版と同じ7市町村・52週の形式）に週合算して書き出す。
 *
 * 観測所の選び方:
 *   気象庁の観測所は市町村ごとに置かれているわけではないため、各市町村の代表点から
 *   直線距離で最も近いアメダス観測所を割り当てている（下記 STATIONS 参照）。
 *   皆野町・東秩父村は「ときがわ」、長瀞町・寄居町は「寄居」を共用しており、
 *   この2組はそれぞれ同じ週別降水量になる（最寄り観測所が同一のため）。
 *
 * 取得方法:
 *   気象庁の「日ごとの値」ページ（daily_s1.php=気象官署、daily_a1.php=アメダス）を
 *   月単位でHTML取得し、降水量(合計)列を正規表現でパースしている（公式のAPIやCSVダウンロード
 *   エンドポイントが無いため。ページ構造は気象庁サイトの仕様変更で変わる可能性がある点に注意）。
 *
 * 使い方:
 *   cd web/scripts
 *   node fetch_rainfall.js
 */

const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "../data/rainfall_weekly.json");

// 週の一覧（既存ダミー版と同じ、日曜始まり・52週）はここで生成する
const START_DATE = "2025-01-05";
const WEEK_COUNT = 52;

// 各市町村に割り当てる最寄りのアメダス観測所（type: "s"=気象官署 / "a"=アメダス、
// 距離は市町村代表点からの直線距離。算出方法は data/README.md 参照）
const REGIONS = [
  {
    code: "chichibu", name: "秩父市", station: { name: "浦山", type: "a", blockNo: "1159" },
    geometry: { type: "Polygon", coordinates: [[[139.04, 35.89], [139.12, 35.89], [139.12, 35.97], [139.04, 35.97], [139.04, 35.89]]] }
  },
  {
    code: "yokoze", name: "横瀬町", station: { name: "秩父", type: "s", blockNo: "47641" },
    geometry: { type: "Polygon", coordinates: [[[139.06, 35.94], [139.14, 35.94], [139.14, 36.02], [139.06, 36.02], [139.06, 35.94]]] }
  },
  {
    code: "minano", name: "皆野町", station: { name: "ときがわ", type: "a", blockNo: "1497" },
    geometry: { type: "Polygon", coordinates: [[[139.12, 35.99], [139.2, 35.99], [139.2, 36.07], [139.12, 36.07], [139.12, 35.99]]] }
  },
  {
    code: "nagatoro", name: "長瀞町", station: { name: "寄居", type: "a", blockNo: "1009" },
    geometry: { type: "Polygon", coordinates: [[[139.14, 36.02], [139.22, 36.02], [139.22, 36.10], [139.14, 36.10], [139.14, 36.02]]] }
  },
  {
    code: "ogano", name: "小鹿野町", station: { name: "上吉田", type: "a", blockNo: "1182" },
    geometry: { type: "Polygon", coordinates: [[[138.94, 35.96], [139.02, 35.96], [139.02, 36.04], [138.94, 36.04], [138.94, 35.96]]] }
  },
  {
    code: "higashichichibu", name: "東秩父村", station: { name: "ときがわ", type: "a", blockNo: "1497" },
    geometry: { type: "Polygon", coordinates: [[[139.21, 35.91], [139.29, 35.91], [139.29, 35.99], [139.21, 35.99], [139.21, 35.91]]] }
  },
  {
    code: "yorii", name: "寄居町", station: { name: "寄居", type: "a", blockNo: "1009" },
    geometry: { type: "Polygon", coordinates: [[[139.24, 36.04], [139.32, 36.04], [139.32, 36.12], [139.24, 36.12], [139.24, 36.04]]] }
  }
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/**
 * "YYYY-MM-DD" に日数を加算して "YYYY-MM-DD" を返す。
 * ローカルタイムゾーンや"+09:00"指定によるUTC変換のズレ（日またぎのバグの元）を避けるため、
 * 時刻を持たない純粋なカレンダー日付として、常にUTC基準のDate.UTC()で計算する。
 */
function addDaysISO(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

/** YYYY-MM-DD文字列を52週分（開始日から7日刻み）生成する */
function buildWeekList(startDate, count) {
  const weeks = [];
  for (let i = 0; i < count; i++) weeks.push(addDaysISO(startDate, i * 7));
  return weeks;
}

/** 週の一覧から、日降水量取得に必要な年月(YYYY-MM)の一覧を重複無く求める */
function neededYearMonths(weeks) {
  const set = new Set();
  weeks.forEach((w) => {
    for (let i = 0; i < 7; i++) set.add(addDaysISO(w, i).slice(0, 7));
  });
  return [...set].sort();
}

/**
 * 指定した観測所・年月の日降水量を取得する。
 * @returns {Map<string, number>} "YYYY-MM-DD" -> 降水量(mm)
 */
async function fetchStationMonth(station, year, month) {
  const url =
    `https://www.data.jma.go.jp/obd/stats/etrn/view/daily_${station.type}1.php` +
    `?prec_no=43&block_no=${station.blockNo}&year=${year}&month=${pad2(month)}&day=&view=`;
  const res = await fetch(url);
  const html = await res.text();

  const result = new Map();
  // 1日分のデータ行を1つずつ取り出す（気象庁サイトのテーブルは全て同じクラス名のtr）
  const rowRe = /<tr class="mtx" style="text-align:right;">([\s\S]*?)<\/tr>/g;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const rowHtml = rowMatch[1];
    const dayMatch = rowHtml.match(/day=(\d+)/);
    if (!dayMatch) continue;
    const day = Number(dayMatch[1]);

    // 先頭の「日」セルは<div><a>を含み<td...>直後が"<"になるため、このパターンには
    // マッチせず自然に読み飛ばされる。そのため最初にマッチするのは実測値のセルになる。
    const cellRe = /<td[^>]*>([^<]*)<\/td>/g;
    const cells = [];
    let cellMatch;
    while ((cellMatch = cellRe.exec(rowHtml)) !== null) cells.push(cellMatch[1].trim());

    // 「s」(気象官署)は [気圧(現地), 気圧(海面), 降水量合計, ...] の順、
    // 「a」(アメダス)は [降水量合計, ...] の順で並んでいる（気象庁サイトの列構成による）
    const precipIndex = station.type === "s" ? 2 : 0;
    const raw = cells[precipIndex];
    const value = raw === undefined || raw === "" || raw === "--" || raw === "///" ? 0 : parseFloat(raw);
    const dateStr = `${year}-${pad2(month)}-${pad2(day)}`;
    result.set(dateStr, Number.isNaN(value) ? 0 : value);
  }
  return result;
}

/** 観測所ごとに、必要な全期間の日降水量をまとめて取得する（Map<"YYYY-MM-DD", mm>） */
async function fetchStationDailySeries(station, yearMonths) {
  const daily = new Map();
  for (const ym of yearMonths) {
    const [year, month] = ym.split("-").map(Number);
    console.log(`  ${station.name}(${station.type}:${station.blockNo}) ${year}年${month}月 取得中...`);
    const monthData = await fetchStationMonth(station, year, month);
    monthData.forEach((v, k) => daily.set(k, v));
    await sleep(300); // 気象庁サーバーへの配慮
  }
  return daily;
}

function weeklySum(dailySeries, weekStart) {
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    const key = addDaysISO(weekStart, i);
    sum += dailySeries.get(key) ?? 0;
  }
  return Number(sum.toFixed(1));
}

async function main() {
  const weeks = buildWeekList(START_DATE, WEEK_COUNT);
  const yearMonths = neededYearMonths(weeks);
  console.log(`対象期間: ${weeks[0]} 〜 ${weeks[weeks.length - 1]}（${yearMonths.length}ヶ月分を取得）`);

  // 観測所は重複があるので(type+blockNo)でユニーク化し、同じ観測所への重複リクエストを避ける
  const stationKey = (s) => `${s.type}:${s.blockNo}`;
  const uniqueStations = new Map();
  REGIONS.forEach((r) => uniqueStations.set(stationKey(r.station), r.station));

  console.log(`観測所数: ${uniqueStations.size}`);
  const seriesByStation = new Map();
  for (const station of uniqueStations.values()) {
    const series = await fetchStationDailySeries(station, yearMonths);
    seriesByStation.set(stationKey(station), series);
  }

  const regionsOutput = REGIONS.map((r) => {
    const series = seriesByStation.get(stationKey(r.station));
    return {
      code: r.code,
      name: r.name,
      geometry: r.geometry,
      weekly: weeks.map((w) => weeklySum(series, w))
    };
  });

  const output = {
    meta: {
      description:
        "気象庁「過去の気象データ検索」の最寄りアメダス観測所（日降水量）を市町村ごとに週合算した実データ。" +
        "皆野町/東秩父村は「ときがわ」、長瀞町/寄居町は「寄居」観測所を共用（最寄りが同一のため同じ値）。",
      unit: "mm",
      weeks
    },
    regions: regionsOutput
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`保存しました: ${OUTPUT_PATH}`);

  const allValues = regionsOutput.flatMap((r) => r.weekly);
  console.log(`値の範囲: ${Math.min(...allValues)} 〜 ${Math.max(...allValues)} mm/週`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
