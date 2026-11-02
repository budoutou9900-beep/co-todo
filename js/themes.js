// 着せ替えテーマの定義。色はここには持たず、css/style.css の
// html[data-theme="<id>"] ブロックで :root の変数を上書きする。
//
// 特定ユーザーだけに見せたいテーマには allowedUids を付ける。
// UIDは FirebaseコンソールのAuthentication画面でパートナーのUIDを確認して記入する。
// 開発中に自分で確認するときは、自分のUIDも一時的にこの配列へ入れてよい（確認後は外す）。
const CHARA_THEME_UIDS = [];

// slots: 画像スロット（フェーズ3）。デフォルトは空なので画像まわりのUIは一切出ない。
// projTone: プロジェクト色（ユーザーが選んだ任意のhex）をテーマの背景になじませる補正値。
//   彩度の上限 s と明度 l（HSL, 0〜1）。ダークは明るく淡く、ライトは深く暗く寄せる。
export const THEMES = {
  default: { label: "デフォルト", slots: [] },
  // 以下4つは docs のデザイン刷新案（1a 墨 / 1b 紙 / 1c 葡萄 / 2a クリーム）
  sumi: { label: "墨", slots: [], projTone: { s: 0.5, l: 0.68 } },
  kami: { label: "紙", slots: [], projTone: { s: 0.45, l: 0.45 } },
  budou: { label: "葡萄", slots: [], projTone: { s: 0.8, l: 0.72 } },
  cream: { label: "クリーム", slots: [], projTone: { s: 0.5, l: 0.48 } },
};
// キャラクター画像付きテーマを足すときは allowedUids: CHARA_THEME_UIDS を付ける（フェーズ3以降）

// theme-boot.js と同じキー。描画前のちらつき防止用のキャッシュ
const STORAGE_KEY = "buto-do-theme";

// 刷新案テーマだけが使うフォント。デフォルトのユーザーに余計な読み込みをさせないよう、
// テーマ適用時にだけ <link> を差し込む（theme-boot.js にも同じURLがある）。
const THEME_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Shippori+Mincho:wght@500;600&family=Zen+Maru+Gothic:wght@500;700&display=swap";

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
  else {
    root.dataset.theme = id;
    ensureThemeFonts();
  }
  syncThemeColorMeta();
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {}
}

// 刷新案テーマ（default 以外）が当たっているか。描画側はこれで文言・マークアップを切り替える。
// default の描画コードは一切通さないことで、既存ユーザーの見た目を変えない。
export function isRedesignTheme() {
  return !!document.documentElement.dataset.theme;
}

function ensureThemeFonts() {
  if (document.getElementById("theme-fonts")) return;
  const link = document.createElement("link");
  link.id = "theme-fonts";
  link.rel = "stylesheet";
  link.href = THEME_FONTS_URL;
  document.head.appendChild(link);
}

// プロジェクト色を現在のテーマ向けに補正する。default では元の色をそのまま返す。
export function themedColor(hex) {
  const tone = THEMES[document.documentElement.dataset.theme]?.projTone;
  if (!tone || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const [h, s] = hexToHsl(hex);
  return hslToHex(h, Math.min(s, tone.s), tone.l);
}

function hexToHsl(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function hslToHex(h, s, l) {
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return "#" + [0, 8, 4].map((n) => Math.round(f(n) * 255).toString(16).padStart(2, "0")).join("");
}

// ステータスバー色はテーマの --bg に合わせる（JSに色を持たないためCSSから読む）
export function syncThemeColorMeta() {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
}
