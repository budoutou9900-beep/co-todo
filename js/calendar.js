import {
  startOfWeek,
  addDays,
  dowJp,
  dayNum,
  isWeekend,
  todayStr,
  escapeHtml,
} from "./utils.js";

const NEUTRAL = "#5a5a72";

function colorForTask(task, projectMap) {
  const p = task.projectId ? projectMap.get(task.projectId) : null;
  return p?.color || NEUTRAL;
}

export function renderWeekStrip(tasks, selectedDate, projects = []) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
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
    // プロジェクト色のドット（最大3つ、未紐付けはグレー）
    const colors = [...new Set(dayTasks.map((t) => colorForTask(t, projectMap)))].slice(0, 3);
    const dowColor = isToday
      ? "rgba(149,128,255,0.85)"
      : wknd
      ? "var(--weekend)"
      : "rgba(240,240,245,0.32)";
    const numClass = isToday ? "week-strip-num today" : "week-strip-num";
    const numColor = wknd && !isToday ? "var(--weekend)" : "rgba(240,240,245,0.45)";
    const dots = colors
      .map(
        (c) => `<div class="week-strip-dot" style="background:${c};opacity:${isToday ? 1 : 0.55}"></div>`
      )
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

export function renderWeekView(tasks, weekStart, projects = []) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const dayOrder = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const today = todayStr();
  let total = 0;
  let html = "";
  for (const dateStr of dayOrder) {
    // 今週は「何が未完了か」が重要なので、完了済みは除外する
    const dayTasks = tasks.filter((t) => t.date === dateStr && !t.done);
    if (dayTasks.length === 0) continue;
    total += dayTasks.length;
    const isToday = dateStr === today;
    const label = `${dowJp(dateStr)} · ${dayNum(dateStr)}`;
    const labelColor = isToday ? "rgba(149,128,255,0.85)" : "rgba(240,240,245,0.32)";
    const rows = dayTasks
      .map((t) => {
        const color = colorForTask(t, projectMap);
        const titleColor = t.done
          ? "color:rgba(240,240,245,0.4);text-decoration:line-through"
          : "color:#f0f0f5";
        const project = t.projectId ? projectMap.get(t.projectId) : null;
        const projLabel = project ? escapeHtml(project.title) : "";
        return `
        <div class="week-task-row" data-task-id="${t.id}">
          <div class="week-task-dot" style="background:${color}"></div>
          <div class="week-task-title" style="${titleColor}">${escapeHtml(t.title)}</div>
          ${projLabel ? `<span class="week-task-proj" style="color:${color}">${projLabel}</span>` : ""}
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
