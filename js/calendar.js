import {
  PLACE_COLORS,
  PLACE_LABELS,
  placeTagStyle,
  startOfWeek,
  addDays,
  dowJp,
  dayNum,
  isWeekend,
  todayStr,
  escapeHtml,
} from "./utils.js";

export function renderWeekStrip(tasks, selectedDate) {
  const weekStart = startOfWeek(selectedDate);
  const today = todayStr();
  let html = "";
  for (let i = 0; i < 7; i++) {
    const dateStr = addDays(weekStart, i);
    const isToday = dateStr === today;
    const isSelected = dateStr === selectedDate;
    const wknd = isWeekend(dateStr);
    const dow = dowJp(dateStr);
    const dayTasks = tasks.filter((t) => t.date === dateStr);
    const places = [...new Set(dayTasks.map((t) => t.location))].filter(Boolean).slice(0, 3);
    const dowColor = isToday
      ? "rgba(149,128,255,0.85)"
      : wknd
      ? "var(--weekend)"
      : "rgba(240,240,245,0.32)";
    const numClass = isToday ? "week-strip-num today" : "week-strip-num";
    const numColor = wknd && !isToday ? "var(--weekend)" : "rgba(240,240,245,0.45)";
    const dots = places
      .map((p) => {
        const c = PLACE_COLORS[locKey(p)] || PLACE_COLORS.研究室;
        return `<div class="week-strip-dot" style="background:${c};opacity:${isToday ? 1 : 0.55}"></div>`;
      })
      .join("");
    html += `
      <div class="week-strip-col" data-date="${dateStr}" style="${isSelected ? "border-radius:10px;background:rgba(255,255,255,0.04)" : ""}">
        <div class="week-strip-dow" style="color:${dowColor}">${dow}</div>
        <div class="${numClass}" style="${isToday ? "" : `color:${numColor}`}">${dayNum(dateStr)}</div>
        <div class="week-strip-dots">${dots}</div>
      </div>`;
  }
  return html;
}

function locKey(location) {
  const map = { lab: "研究室", home: "家", transit: "移動中" };
  return map[location] || location;
}

export function locToJp(location) {
  return locKey(location);
}

export function jpToLoc(jp) {
  const map = { 研究室: "lab", 家: "home", 移動中: "transit" };
  return map[jp] || null;
}

export function renderWeekView(tasks, weekStart, filter) {
  const dayOrder = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const today = todayStr();
  let total = 0;
  let html = "";
  for (const dateStr of dayOrder) {
    let dayTasks = tasks.filter((t) => t.date === dateStr);
    if (filter !== "全て") {
      dayTasks = dayTasks.filter((t) => locKey(t.location) === filter);
    }
    if (dayTasks.length === 0) continue;
    total += dayTasks.length;
    const isToday = dateStr === today;
    const label = `${dowJp(dateStr)} · ${dayNum(dateStr)}`;
    const labelColor = isToday ? "rgba(149,128,255,0.85)" : "rgba(240,240,245,0.32)";
    const rows = dayTasks
      .map((t) => {
        const place = locKey(t.location);
        const color = PLACE_COLORS[place] || PLACE_COLORS.研究室;
        const titleColor = t.done
          ? "color:rgba(240,240,245,0.4);text-decoration:line-through"
          : "color:#f0f0f5";
        return `
        <div class="week-task-row" data-task-id="${t.id}">
          <div class="week-task-dot" style="background:${color}"></div>
          <div class="week-task-title" style="${titleColor}">${escapeHtml(t.title)}</div>
          <div class="week-task-time">${t.time ? escapeHtml(t.time) : ""}</div>
          <span class="place-tag" style="${placeTagStyle(place)}">${place}</span>
        </div>`;
      })
      .join("");
    html += `
      <div class="week-group">
        <div class="week-group-label-row">
          <div class="week-group-label" style="color:${labelColor}">${label}</div>
          ${isToday ? '<div class="today-badge">TODAY</div>' : ""}
        </div>
        <div class="week-group-card">${rows}</div>
      </div>`;
  }
  return { html, total, empty: total === 0 };
}

export { PLACE_LABELS };
