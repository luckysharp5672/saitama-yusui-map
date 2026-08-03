// ============================================================
// export.js
// テーブルの内容をCSVで、地図上のフィルタ済みデータをGeoJSONで
// ブラウザからダウンロードさせるための小さなユーティリティ群。
// ============================================================

/** 文字列をCSVのフィールドとして安全な形にする（カンマ・改行・ダブルクォートを含む場合は引用符で囲む） */
function csvField(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** 列定義 + 行データからCSV文字列を生成する */
export function rowsToCSV(columns, rows) {
  const header = columns.map((c) => csvField(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvField(row[c.key])).join(","));
  // Excelで開いたときの文字化け対策としてBOMを付与する
  return "﻿" + [header, ...lines].join("\n");
}

/** 任意の文字列データをファイルとしてダウンロードさせる共通処理 */
function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadCSV(columns, rows, filename) {
  downloadTextFile(rowsToCSV(columns, rows), filename, "text/csv;charset=utf-8");
}

export function downloadGeoJSON(featureCollection, filename) {
  downloadTextFile(JSON.stringify(featureCollection, null, 2), filename, "application/geo+json");
}
