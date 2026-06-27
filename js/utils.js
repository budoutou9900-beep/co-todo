export const PLACE_COLORS = {
  研究室: "#9580ff",
  家: "#5b8aff",
  移動中: "#d4a558",
};

export const PLACE_LABELS = ["研究室", "家", "移動中"];

export function hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

export function placeTagStyle(place, faded) {
  const c = PLACE_COLORS[place] || PLACE_COLORS.研究室;
  const [r, g, b] = hexToRgb(c);
  return `background:rgba(${r},${g},${b},0.16);color:${c};opacity:${faded ? 0.6 : 1}`;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function toDateStr(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function todayStr() {
  return toDateStr(new Date());
}

export function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return toDateStr(d);
}

const DOW_JP = ["日", "月", "火", "水", "木", "金", "土"];
const MONTH_DAY_JP = (d) => `${d.getMonth() + 1}月${d.getDate()}日`;

export function formatHeaderDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${MONTH_DAY_JP(d)} ${DOW_JP[d.getDay()]}`;
}

export function dowJp(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return DOW_JP[d.getDay()];
}

export function dayNum(dateStr) {
  return new Date(dateStr + "T00:00:00").getDate();
}

export function isWeekend(dateStr) {
  const dow = new Date(dateStr + "T00:00:00").getDay();
  return dow === 0 || dow === 6;
}

export function startOfWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const dow = d.getDay();
  const diff = dow === 0 ? -6 : 1 - dow;
  d.setDate(d.getDate() + diff);
  return toDateStr(d);
}

export function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
