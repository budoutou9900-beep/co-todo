import {
  startOfWeek,
  addDays,
  dowJp,
  dayNum,
  isWeekend,
  todayStr,
  toDateStr,
  escapeHtml,
  hexToRgb,
} from "./utils.js";

const NEUTRAL = "#5a5a72";
const EVENT_COLOR_FALLBACK = "#6b7a99"; // カレンダー色が取得できない場合のフォールバック
const EVENT_COLOR_FALLBACK_RGB = hexToRgb(EVENT_COLOR_FALLBACK).join(",");
const DOW_HEAD = ["日", "月", "火", "水", "木", "金", "土"];
const MAX_CHIPS = 3; // 1セルに出すチップの最大数

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

// 月カレンダー（日曜始まりの6週グリッド）。
// tasks: 全タスク / eventsByDate: { "YYYY-MM-DD": [ev,...] } / monthAnchor: 表示月の任意の日
// weekDetailDate: 今週タブでインライン表示中の日付（選択中セルのハイライトに使う）
export function renderMonthCalendar(tasks, eventsByDate = {}, projects = [], monthAnchor, weekDetailDate = null) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  // プロジェクトの締切日 → プロジェクト。同日に複数件あれば先に見つかったものを優先。
  const dueByDate = new Map();
  for (const p of projects) {
    if (p.dueDate && !dueByDate.has(p.dueDate)) dueByDate.set(p.dueDate, p);
  }
  const today = todayStr();
  const anchor = new Date(monthAnchor + "T00:00:00");
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const monthLabel = `${year}年${month + 1}月`;

  // グリッド開始 = 当月1日のある週の日曜日
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());

  const head = DOW_HEAD.map((d, i) => {
    const color = i === 0 ? "var(--weekend)" : i === 6 ? "#6f9bff" : "rgba(240,240,245,0.4)";
    return `<div class="mc-dow" style="color:${color}">${d}</div>`;
  }).join("");

  let cells = "";
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateStr = toDateStr(d);
    const inMonth = d.getMonth() === month;
    const isToday = dateStr === today;
    const dow = d.getDay();
    const numColor = isToday
      ? "#fff"
      : !inMonth
      ? "rgba(240,240,245,0.22)"
      : dow === 0
      ? "var(--weekend)"
      : dow === 6
      ? "#6f9bff"
      : "rgba(240,240,245,0.6)";

    // チップ: Google予定 → タスク の順、最大 MAX_CHIPS
    const evs = (eventsByDate[dateStr] || []).map((ev) => ({
      label: ev.summary,
      color: ev.color || EVENT_COLOR_FALLBACK,
    }));
    const tks = tasks
      .filter((t) => t.date === dateStr)
      .map((t) => ({
        label: t.title,
        color: (t.projectId && projectMap.get(t.projectId)?.color) || NEUTRAL,
        done: t.done,
      }));
    const items = [...evs, ...tks];
    const shown = items.slice(0, MAX_CHIPS);
    const moreN = items.length - shown.length;
    const chips =
      shown
        .map(
          (it) =>
            `<div class="mc-chip" style="background:${it.color};${it.done ? "opacity:0.45;" : ""}">${escapeHtml(
              it.label
            )}</div>`
        )
        .join("") + (moreN > 0 ? `<div class="mc-more">+${moreN}</div>` : "");

    // プロジェクトの締切日は、そのプロジェクトのカラーで日付バッジをハイライトする。
    // 今日と重なる場合は今日バッジ（アクセントカラー）を残しつつ枠線で締切も分かるようにする。
    const dueProject = dueByDate.get(dateStr);
    let numClass = "mc-num";
    let numStyle = `color:${numColor}`;
    let numTitle = "";
    if (dueProject) {
      const [r, g, b] = hexToRgb(dueProject.color);
      numTitle = ` title="${escapeHtml(dueProject.title)} の締切"`;
      if (isToday) {
        numClass += " mc-today";
        numStyle = `color:#fff;border:2px solid ${dueProject.color}`;
      } else {
        numClass += " mc-due";
        numStyle = `color:#fff;background:${dueProject.color};box-shadow:0 0 10px rgba(${r},${g},${b},0.55)`;
      }
    } else if (isToday) {
      numClass += " mc-today";
    }
    const isSelected = dateStr === weekDetailDate;

    cells += `
      <div class="mc-cell${inMonth ? "" : " mc-out"}${isSelected ? " mc-selected" : ""}" data-date="${dateStr}">
        <div class="${numClass}" style="${numStyle}"${numTitle}>${d.getDate()}</div>
        <div class="mc-chips">${chips}</div>
      </div>`;
  }

  return `
    <div class="mc-wrap">
      <div class="mc-header">
        <div class="mc-nav" data-cal-nav="prev">‹</div>
        <div class="mc-title">${monthLabel}</div>
        <div class="mc-nav" data-cal-nav="next">›</div>
      </div>
      <div class="mc-grid mc-head-row">${head}</div>
      <div class="mc-grid mc-cells">${cells}</div>
    </div>`;
}

export function renderWeekView(tasks, weekStart, projects = [], eventsByDate = {}) {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const dayOrder = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(weekStart, i));
  const today = todayStr();
  let total = 0;
  let html = "";
  for (const dateStr of dayOrder) {
    // 今週は「何が未完了か」が重要なので、完了済みタスクは除外する（カレンダー予定は全件）
    const dayTasks = tasks.filter((t) => t.date === dateStr && !t.done);
    const dayEvents = eventsByDate[dateStr] || [];
    if (dayTasks.length === 0 && dayEvents.length === 0) continue;
    total += dayTasks.length;
    const isToday = dateStr === today;
    const label = `${dowJp(dateStr)} · ${dayNum(dateStr)}`;
    const labelColor = isToday ? "rgba(149,128,255,0.85)" : "rgba(240,240,245,0.32)";
    // Googleカレンダー予定はタスクと見分けがつくよう、丸ドットではなくカレンダーアイコン＋
    // 専用の背景トーン（.week-event-row）で区別する（today.jsのrenderCalEventCardと同系統）。
    const eventRows = dayEvents
      .map((ev) => {
        const rgb = ev.color ? hexToRgb(ev.color).join(",") : EVENT_COLOR_FALLBACK_RGB;
        return `
        <div class="week-task-row week-event-row" style="cursor:default;background:rgba(${rgb},0.08)">
          <div class="week-event-icon" style="background:rgba(${rgb},0.18)">
            <svg width="10" height="10" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="14" rx="2" stroke="rgb(${rgb})" stroke-width="1.8"/><path d="M3 9h16M8 3v4M14 3v4" stroke="rgb(${rgb})" stroke-width="1.8" stroke-linecap="round"/></svg>
          </div>
          <div class="week-task-title" style="color:#f0f0f5">${escapeHtml(ev.summary)}</div>
        </div>`;
      })
      .join("");
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
        <div class="week-group-card">${eventRows}${rows}</div>
      </div>`;
  }
  return { html, total, empty: total === 0 };
}
