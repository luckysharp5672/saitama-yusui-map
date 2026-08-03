// ============================================================
// fieldSurvey.js
// 現地調査記録の「下書き」をブラウザのlocalStorageに保存・管理するモジュール。
//
// 設計方針:
// - 既存データ（springs.geojson / wetland_1997.geojson）は一切書き換えない。
//   現地調査の結果は別ファイル（data/field_survey.geojson）に追記する形にする。
// - 現地（電波の悪い場所）では通信せずにその場で記録できるよう、入力内容は
//   まずこの端末のlocalStorageに「下書き」として溜める。
// - 帰宅後、下書きを取り込み済みデータとマージしたGeoJSONとして書き出し（エクスポート）、
//   そのファイルで data/field_survey.geojson を上書き・commit・pushする運用を想定している。
// - 1つの地点を複数回訪れた場合も、訪問ごとに別レコードとして残す（上書きしない）。
//   そうすることで「いつ・誰が・どう確認したか」の履歴を追える。
// ============================================================

const STORAGE_KEY = "yusui_field_survey_drafts_v1";

/** 現況の選択肢。既存データ（湧出中/枯渇/不明）に「要再訪」を加えたもの。 */
export const FIELD_SURVEY_STATUS_OPTIONS = ["湧出中", "枯渇", "不明", "要再訪"];

function loadDraftsFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("現地調査の下書き読み込みに失敗しました。空の状態から始めます。", e);
    return [];
  }
}

function saveDraftsToStorage(features) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(features));
}

function generateId() {
  return `fieldsurvey_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** フォームの入力値(entry)から、GeoJSON Featureのpropertiesを組み立てる（新規・編集共通） */
function buildProperties(id, entry) {
  return {
    id,
    target_dataset: entry.targetDataset, // "springs" | "wetland1997" | "new"
    target_id: entry.targetId || null,   // 既存データの id（新規地点はnull）
    target_name: entry.targetName || "", // 表示用の名称（新規地点は現地で付けた名前）
    status: entry.status,
    surveyed_at: entry.surveyedAt,
    surveyor: entry.surveyor || "",
    address_note: entry.addressNote || "",
    notes: entry.notes || "",
    photo_url: entry.photoUrl || "",
    is_draft: true // エクスポート後に見分けが付くよう残しておく（表示上の参考用）
  };
}

/**
 * 現地調査の下書きを管理するストアを作る。
 * 画面をまたいで同じ状態を参照できるよう、main.js側で1つだけ生成して使う。
 */
export function createFieldSurveyStore() {
  let drafts = loadDraftsFromStorage();

  return {
    /** 現在の下書き一覧（GeoJSON Feature の配列）を返す */
    getDrafts() {
      return drafts;
    },

    /** idを指定して下書き1件を取得する（編集フォームの初期値を埋めるのに使う） */
    getDraft(id) {
      return drafts.find((f) => f.properties.id === id) || null;
    },

    /**
     * 新しい現地調査記録を下書きとして追加する。
     * @param {object} entry - フォームから集めた入力値
     *   { targetDataset, targetId, targetName, lng, lat, status, surveyedAt,
     *     surveyor, addressNote, notes, photoUrl }
     */
    addDraft(entry) {
      const feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [entry.lng, entry.lat] },
        properties: buildProperties(generateId(), entry)
      };
      drafts = [...drafts, feature];
      saveDraftsToStorage(drafts);
      return feature;
    },

    /**
     * 既存の下書き（まだエクスポート/commitしていないもの）を編集する。
     * 確定済み（サーバーから読み込んだ）レコードはここでは扱えない
     * （静的サイトのためクライアントからリポジトリのファイルを書き換えられない）。
     */
    updateDraft(id, entry) {
      const feature = {
        type: "Feature",
        geometry: { type: "Point", coordinates: [entry.lng, entry.lat] },
        properties: buildProperties(id, entry)
      };
      drafts = drafts.map((f) => (f.properties.id === id ? feature : f));
      saveDraftsToStorage(drafts);
      return feature;
    },

    /** 下書きを1件削除する（まだpushしていない誤入力の取り消し用） */
    deleteDraft(id) {
      drafts = drafts.filter((f) => f.properties.id !== id);
      saveDraftsToStorage(drafts);
    },

    /** 下書きを全て消す（エクスポート後、commit/push完了を確認してから呼ぶ想定） */
    clearDrafts() {
      drafts = [];
      saveDraftsToStorage(drafts);
    }
  };
}

/**
 * サーバー（data/field_survey.geojson）から読み込んだ確定済みデータと、
 * ローカルの下書きをマージして、表示・エクスポート用の1つのGeoJSONにする。
 * 万一IDが重複した場合は下書き側を優先する。
 */
export function mergeFieldSurveyData(loadedGeoJSON, draftFeatures) {
  const byId = new Map();
  (loadedGeoJSON?.features || []).forEach((f) => byId.set(f.properties.id, f));
  draftFeatures.forEach((f) => byId.set(f.properties.id, f));
  const merged = [...byId.values()];
  merged.sort((a, b) => String(a.properties.surveyed_at).localeCompare(String(b.properties.surveyed_at)));
  return { type: "FeatureCollection", features: merged };
}
