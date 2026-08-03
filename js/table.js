// ============================================================
// table.js
// 下部パネルのスプレッドシート風テーブル表示（ソート可能）を担当するモジュール。
// データの中身（湧水地点 or ポテンシャルグリッド）には依存せず、
// 「列定義 + 行データ」を受け取って描画するだけの汎用コンポーネントにしてある。
// ============================================================

/**
 * テーブルコントローラを作成する。
 * @param {HTMLTableElement} tableEl - <table id="data-table"> 要素
 * @param {HTMLElement} rowCountEl - 件数表示用要素
 */
export function createTableController(tableEl, rowCountEl) {
  const theadRow = tableEl.querySelector("thead tr");
  const tbody = tableEl.querySelector("tbody");

  let currentColumns = [];
  let currentRows = [];
  let sortKey = null;
  let sortDir = "asc"; // "asc" | "desc"

  function render() {
    // ---- ヘッダー描画 ----
    theadRow.innerHTML = "";
    currentColumns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.label;
      th.dataset.key = col.key;
      if (sortKey === col.key) th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
      th.addEventListener("click", () => {
        if (sortKey === col.key) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortKey = col.key;
          sortDir = "asc";
        }
        render();
      });
      theadRow.appendChild(th);
    });

    // ---- 行データのソート ----
    const sortedRows = [...currentRows];
    if (sortKey) {
      sortedRows.sort((a, b) => {
        const va = a[sortKey];
        const vb = b[sortKey];
        let cmp;
        if (typeof va === "number" && typeof vb === "number") {
          cmp = va - vb;
        } else {
          cmp = String(va).localeCompare(String(vb), "ja");
        }
        return sortDir === "asc" ? cmp : -cmp;
      });
    }

    // ---- ボディ描画 ----
    tbody.innerHTML = "";
    const fragment = document.createDocumentFragment();
    sortedRows.forEach((row) => {
      const tr = document.createElement("tr");
      currentColumns.forEach((col) => {
        const td = document.createElement("td");
        const v = row[col.key];
        td.textContent = v === undefined || v === null ? "" : String(v);
        tr.appendChild(td);
      });
      fragment.appendChild(tr);
    });
    tbody.appendChild(fragment);

    if (rowCountEl) rowCountEl.textContent = `${sortedRows.length} 件`;
  }

  return {
    /** 表示するデータを差し替える。tabを切り替えたときや、閾値フィルタ変更時に呼ぶ。 */
    setData(columns, rows) {
      currentColumns = columns;
      currentRows = rows;
      sortKey = null;
      render();
    },
    /** 現在ソート済みの行データを取得する（CSV/GeoJSONダウンロード用） */
    getSortedRows() {
      const sortedRows = [...currentRows];
      if (sortKey) {
        sortedRows.sort((a, b) => {
          const va = a[sortKey];
          const vb = b[sortKey];
          let cmp;
          if (typeof va === "number" && typeof vb === "number") cmp = va - vb;
          else cmp = String(va).localeCompare(String(vb), "ja");
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
      return sortedRows;
    },
    getColumns() {
      return currentColumns;
    }
  };
}
