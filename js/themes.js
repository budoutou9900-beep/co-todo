// 着せ替えテーマの定義。色はここには持たず、css/style.css の
// html[data-theme="<id>"] ブロックで :root の変数を上書きする。
//
// 特定ユーザーだけに見せたいテーマには allowedUids を付ける。
// UIDは FirebaseコンソールのAuthentication画面でパートナーのUIDを確認して記入する。
// 開発中に自分で確認するときは、自分のUIDも一時的にこの配列へ入れてよい（確認後は外す）。
const CHARA_THEME_UIDS = [];

// slots: 画像スロット（フェーズ3）。デフォルトは空なので画像まわりのUIは一切出ない。
export const THEMES = {
  default: { label: "デフォルト", slots: [] },
  // 以下4つは docs のデザイン刷新案（1a 墨 / 1b 紙 / 1c 葡萄 / 2a クリーム）
  sumi: { label: "墨", slots: [] },
  kami: { label: "紙", slots: [] },
  budou: { label: "葡萄", slots: [] },
  cream: { label: "クリーム", slots: [] },
};
// キャラクター画像付きテーマを足すときは allowedUids: CHARA_THEME_UIDS を付ける（フェーズ3以降）

// theme-boot.js と同じキー。描画前のちらつき防止用のキャッシュ
const STORAGE_KEY = "buto-do-theme";

// 未設定・未知のID・対象外ユーザー向けのテーマは default 扱い
export function resolveThemeId(id, uid) {
  const theme = THEMES[id];
  if (!theme) return "default";
  if (theme.allowedUids && !theme.allowedUids.includes(uid)) return "default";
  return id;
}

export function availableThemes(uid) {
  return Object.entries(THEMES)
    .filter(([, t]) => !t.allowedUids || t.allowedUids.includes(uid))
    .map(([id, t]) => ({ id, ...t }));
}

export function applyTheme(id) {
  const root = document.documentElement;
  // default は属性自体を付けない（実装前とまったく同じDOM・見た目にするため）
  if (id === "default") delete root.dataset.theme;
  else root.dataset.theme = id;
  syncThemeColorMeta();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

// ステータスバー色はテーマの --bg に合わせる（JSに色を持たないためCSSから読む）
export function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}
