import { PLACE_COLORS, hexToRgb, placeTagStyle, escapeHtml } from "./utils.js";
import { locToJp } from "./calendar.js";

function checkSvg() {
  return `<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-6.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:14;animation:checkdraw .35s ease forwards"/></svg>`;
}

function timeRangeLabel(task) {
  if (!task.time) return "時間未定";
  if (task.duration) {
    const [h, m] = task.time.split(":").map(Number);
    const endMinutes = h * 60 + m + task.duration;
    const eh = String(Math.floor(endMinutes / 60) % 24).padStart(2, "0");
    const em = String(endMinutes % 60).padStart(2, "0");
    return `${task.time}–${eh}:${em}`;
  }
  return task.time;
}

function renderTaskCard(t) {
  const place = locToJp(t.location);
  const color = PLACE_COLORS[place] || PLACE_COLORS.研究室;
  const [r, g, b] = hexToRgb(color);
  const cardStyle = `background:rgba(${r},${g},${b},${t.done ? 0.05 : 0.1});border-left:2.5px solid ${
    t.done ? `rgba(${r},${g},${b},0.4)` : color
  };`;
  const checkStyle = t.done
    ? `background:${color};box-shadow:0 0 12px rgba(${r},${g},${b},0.6)`
    : `border:1.6px solid rgba(${r},${g},${b},0.45)`;
  const titleStyle = t.done
    ? "color:rgba(240,240,245,0.4);text-decoration:line-through;text-decoration-color:rgba(149,128,255,0.4)"
    : "color:#f0f0f5";
  const repeatLabel = repeatToLabel(t.repeat);
  return `
      <div class="task-row" data-task-id="${t.id}">
        <div class="task-time-col">${t.time || ""}</div>
        <div class="task-card" style="${cardStyle}">
          <div class="task-card-inner">
            <div class="task-check" style="${checkStyle}">${t.done ? checkSvg() : ""}</div>
            <div style="flex:1;min-width:0">
              <div class="task-title" style="${titleStyle}">${escapeHtml(t.title)}</div>
              <div class="task-meta-row">
                <span class="task-time-range">${timeRangeLabel(t)}</span>
                <span class="place-tag" style="${placeTagStyle(place, t.done)}">${place}</span>
                ${repeatLabel ? `<span class="task-repeat">↻ ${repeatLabel}</span>` : ""}
              </div>
            </div>
          </div>
        </div>
      </div>`;
}

const CAL_COLOR = "78,197,212"; // カレンダー予定の識別色（シアン）

function hm(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function calEventTimeLabel(ev) {
  if (ev.allDay) return "終日";
  const s = hm(ev.start);
  const e = ev.end ? hm(ev.end) : null;
  return e ? `${s}–${e}` : s;
}

function renderCalEventCard(ev) {
  const timeTop = ev.allDay ? "" : hm(ev.start);
  return `
      <div class="task-row" style="cursor:default">
        <div class="task-time-col">${timeTop}</div>
        <div class="task-card" style="background:rgba(${CAL_COLOR},0.08);border-left:2.5px solid rgb(${CAL_COLOR});">
          <div class="task-card-inner">
            <div class="task-check" style="border:none;background:rgba(${CAL_COLOR},0.16)">
              <svg width="12" height="12" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="14" rx="2" stroke="rgb(${CAL_COLOR})" stroke-width="1.6"/><path d="M3 9h16M8 3v4M14 3v4" stroke="rgb(${CAL_COLOR})" stroke-width="1.6" stroke-linecap="round"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div class="task-title" style="color:#f0f0f5">${escapeHtml(ev.summary)}</div>
              <div class="task-meta-row">
                <span class="task-time-range">${calEventTimeLabel(ev)}</span>
                <span class="place-tag" style="background:rgba(${CAL_COLOR},0.16);color:rgb(${CAL_COLOR})">カレンダー</span>
              </div>
            </div>
          </div>
        </div>
      </div>`;
}

// タスクとカレンダー予定を時刻順に統合して描画する。
// 並び順: 終日予定 → 時刻ありを昇順 → 時間未定タスクを最後。
function minutesOf(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function renderTodayTimeline(tasks, calEvents = []) {
  if (tasks.length === 0 && calEvents.length === 0) {
    return '<div class="empty-state">この日の予定はありません</div>';
  }
  // ソートキー(分): 終日予定=-1（最上部）/ 時刻あり=その分 / 時間未定タスク=9999（最下部）
  const items = [
    ...tasks.map((t) => ({ key: t.time ? minutesOf(t.time) : 9999, html: renderTaskCard(t) })),
    ...calEvents.map((ev) => ({
      key: ev.allDay ? -1 : minutesOf(hm(ev.start)),
      html: renderCalEventCard(ev),
    })),
  ];
  items.sort((a, b) => a.key - b.key);
  return items.map((i) => i.html).join("");
}

export function repeatToLabel(repeat) {
  if (!repeat || repeat.type === "none") return null;
  if (repeat.type === "interval") return `${repeat.interval}日ごと`;
  if (repeat.type === "weekly") {
    const dows = ["日", "月", "火", "水", "木", "金", "土"];
    return (repeat.days || []).map((d) => dows[d]).join("・") + "曜";
  }
  return null;
}
