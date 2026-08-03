/**
 * geocode_springs.js
 *
 * 環境省「湧水保全ポータルサイト」の埼玉県ページ
 * (https://www.env.go.jp/water/yusui/result/sub2/saitama.html) に掲載されている
 * 湧水一覧（名称・所在地・概要等）を取得し、国土地理院「住所検索API」で
 * 住所から緯度経度を推定して data/springs.geojson を生成するスクリプト。
 *
 * このページのデータには緯度経度が含まれていない（住所のみ）ため、住所文字列を
 * ジオコーディングして座標を得ている。番地の記載が無い住所（大字・地区名まで）は
 * その地区の代表地点になるため、accuracy を "おおよそ" として区別している。
 *
 * 依存パッケージなし（Node.js 18+ の組み込み fetch のみを使用）。
 *
 * 使い方:
 *   cd web/scripts
 *   node geocode_springs.js
 *   （実行すると ../data/springs.geojson を上書きします）
 */

const fs = require("fs");
const path = require("path");

const SOURCE_URL = "https://www.env.go.jp/water/yusui/result/sub2/saitama.html";
const GSI_ADDRESS_SEARCH_URL = "https://msearch.gsi.go.jp/address-search/AddressSearch?q=";
const OUTPUT_PATH = path.join(__dirname, "../data/springs.geojson");
const GEOCODE_INTERVAL_MS = 120; // 国土地理院APIへの連続アクセスを避けるための間隔

// 所在地に番地・丁目等の数字が含まれるかどうか（正確/おおよそ の判定に使う）
const HAS_DIGIT = /[0-9０-９]/;

/** HTMLタグを取り除き、空白を正規化してテキストだけを取り出す */
function stripTags(html) {
  return html
    .replace(/<br\s*\/?>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&times;/g, "×")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * ページ内の <table>...<tbody>...</tbody> を行単位でパースする。
 * 環境省のこのページは表形式（市区町村名/名称/ふりがな/所在地/概要等/アクセス/湧水保全活動/写真等）
 * で統一されているため、単純な正規表現パースで十分読み取れる。
 */
function parseTable(html) {
  const tbodyStart = html.indexOf("<tbody>");
  const tbodyEnd = html.indexOf("</tbody>");
  const tbody = html.slice(tbodyStart, tbodyEnd);
  const rowsHtml = tbody.split("<tr>").slice(1).map((r) => "<tr>" + r);

  return rowsHtml.map((rowHtml) => {
    const cells = [];
    const cellRe = /<(th|td)[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = cellRe.exec(rowHtml)) !== null) {
      cells.push(stripTags(m[2]));
    }
    const [city, name, kana, address, desc, access, conservation] = cells;
    return { city, name, kana, address, desc, access, conservation };
  });
}

/** 住所を国土地理院 住所検索API でジオコーディングする */
async function geocodeAddress(query) {
  const res = await fetch(GSI_ADDRESS_SEARCH_URL + encodeURIComponent(query));
  const results = await res.json();
  if (results.length === 0) return null;
  return { coordinates: results[0].geometry.coordinates, title: results[0].properties.title };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const html = await fetch(SOURCE_URL).then((r) => r.text());
  const rows = parseTable(html);
  console.log(`Parsed ${rows.length} rows from the source table.`);

  const features = [];
  for (let i = 0; i < rows.length; i++) {
    const { city, name, kana, address, desc, access, conservation } = rows[i];

    // 所在地の文字列に既に市区町村名が含まれていれば重複させない
    const bodyAddress = address.includes(city) ? address : city + address;
    const query = "埼玉県" + bodyAddress;

    let geocoded = null;
    try {
      geocoded = await geocodeAddress(query);
    } catch (e) {
      console.error(`  ! geocode failed for "${query}": ${e.message}`);
    }
    await sleep(GEOCODE_INTERVAL_MS);

    if (!geocoded) {
      console.warn(`  ! no geocode result for "${query}" (${name}) — skipped`);
      continue;
    }

    const hasBanchi = HAS_DIGIT.test(address);
    const accuracy = hasBanchi ? "正確" : "おおよそ";
    const positionNote = hasBanchi
      ? "環境省公表データの所在地（住所）を国土地理院住所検索APIでジオコーディングした地点です。番地までの記載があるため比較的位置精度は高いですが、湧水そのものの正確な座標ではなく代表地点である点にご留意ください。"
      : "環境省公表データの所在地は大字・地区名までの記載で番地の記載が無いため、国土地理院住所検索APIでその地区の代表地点を推定表示しています。実際の湧水位置とは離れている可能性があります。";

    features.push({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [Number(geocoded.coordinates[0].toFixed(6)), Number(geocoded.coordinates[1].toFixed(6))]
      },
      properties: {
        id: `spring_${String(features.length + 1).padStart(3, "0")}`,
        name,
        kana,
        municipality: city,
        address,
        description: desc,
        access,
        conservation_activity: conservation || "",
        status: "湧出中", // 出典データに枯渇の明記が無いため一律この値にしている
        confirmed_year: null, // 出典データに確認年の記載が無い
        accuracy,
        source: "環境省 湧水保全ポータルサイト（埼玉県の代表的な湧水）",
        source_url: SOURCE_URL,
        position_note: positionNote
      }
    });

    if ((i + 1) % 10 === 0) console.log(`  geocoded ${i + 1}/${rows.length}`);
  }

  const geojson = { type: "FeatureCollection", features };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(geojson, null, 2));

  const approx = features.filter((f) => f.properties.accuracy === "おおよそ").length;
  console.log(`Wrote ${features.length} features to ${OUTPUT_PATH} (${approx} are "おおよそ" / estimated positions).`);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
