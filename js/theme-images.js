// 着せ替えテーマの画像スロット（キャラクターテーマ専用）。
// 画像は第三者の著作物になりうるので、Firestore / Storage にはアップロードせず、
// その端末の IndexedDB にだけ保存する（リポジトリ・Hostingにも置かない）。
// キーは `${uid}:${themeId}:${slotId}`、値は縮小済みの Blob。

const DB_NAME = "buto-do-theme";
const STORE = "images";

// 取り込み時の長辺の上限。巨大な写真をそのまま保存しない
const MAX_EDGE = { bg: 1600 };
const DEFAULT_MAX_EDGE = 512;

let dbPromise = null;
function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    // 失敗したら次回また開き直せるようにする（プライベートブラウズ等）
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

async function run(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

const keyOf = (uid, themeId, slotId) => `${uid}:${themeId}:${slotId}`;

// { slotId: Blob } を返す。未設定のスロットは含めない
export async function loadSlotImages(uid, themeId, slotIds) {
  const out = {};
  for (const slot of slotIds) {
    try {
      const blob = await run("readonly", (s) => s.get(keyOf(uid, themeId, slot)));
      if (blob) out[slot] = blob;
    } catch {}
  }
  return out;
}

export async function saveSlotImage(uid, themeId, slotId, file) {
  const blob = await shrinkImage(file, MAX_EDGE[slotId] || DEFAULT_MAX_EDGE);
  await run("readwrite", (s) => s.put(blob, keyOf(uid, themeId, slotId)));
  return blob;
}

export async function deleteSlotImage(uid, themeId, slotId) {
  await run("readwrite", (s) => s.delete(keyOf(uid, themeId, slotId)));
}

// canvas で長辺 maxEdge に縮小する。JPEG以外はPNGで書き出して透過を残す
async function shrinkImage(file, maxEdge) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("画像を読み込めませんでした"));
      el.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const isJpeg = file.type === "image/jpeg";
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("画像を変換できませんでした"))),
        isJpeg ? "image/jpeg" : "image/png",
        0.88
      )
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
