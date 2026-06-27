import { hexToRgb, escapeHtml } from "./utils.js";

const NEUTRAL = "#5a5a72"; // プロジェクト未紐付けタスクの色（薄いグレー）

function checkSvg() {
  return `<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-6.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="stroke-dasharray:14;animation:checkdraw .35s ease forwards"/></svg>`;
}

// プロジェクトに紐付いていればプロジェクト色、なければグレー
function colorOf(task, projectMap) {
  const p = task.projectId ? projectMap.get(task.projectId) : null;
  return p?.color || NEUTRAL;
}

function renderTaskCard(t, projectMap) {
  const color = colorOf(t, projectMap);
  const [r, g, b] = hexToRgb(color);
  const project = t.projectId ? projectMap.get(t.projectId) : null;
  const cardStyle = `background:rgba(${r},${g},${b},${t.done ? 0.05 : 0.1});border-left:2.5px solid ${
    t.done ? `rgba(${r},${g},${b},0.4)` : color
  };`;
  const checkStyle = t.done
    ? `background:${color};box-shadow:0 0 12px rgba(${r},${g},${b},0.6)`
    : `border:1.6px solid rgba(${r},${g},${b},0.45)`;
  const titleStyle = t.done
    ? "color:rgba(240,240,245,0.4);text-decoration:line-through;text-decoration-color:rgba(149,128,255,0.4)"
    : "color:#f0f0f5";
  const projChip = project
    ? `<span class="task-proj-chip" style="background:rgba(${r},${g},${b},0.16);color:${color}">${escapeHtml(project.title)}</span>`
    : "";
  const repeatChip = t.repeat && t.repeat.type !== "none" ? `<span class="task-repeat-icon">↻</span>` : "";
  return `
      <div class="task-row" data-task-id="${t.id}">
        <div class="task-card task-card-1line" style="${cardStyle}">
          <div class="task-check" style="${checkStyle}">${t.done ? checkSvg() : ""}</div>
          <div class="task-title-1line" style="${titleStyle}">${escapeHtml(t.title)}</div>
          ${repeatChip}
          ${projChip}
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
  return `
      <div class="task-row" style="cursor:default">
        <div class="task-card task-card-1line" style="background:rgba(${CAL_COLOR},0.08);border-left:2.5px solid rgb(${CAL_COLOR});">
          <div class="task-check" style="border:none;background:rgba(${CAL_COLOR},0.16)">
            <svg width="12" height="12" viewBox="0 0 22 22" fill="none"><rect x="3" y="5" width="16" height="14" rx="2" stroke="rgb(${CAL_COLOR})" stroke-width="1.6"/><path d="M3 9h16M8 3v4M14 3v4" stroke="rgb(${CAL_COLOR})" stroke-width="1.6" stroke-linecap="round"/></svg>
          </div>
          <div class="task-title-1line" style="color:#f0f0f5">${escapeHtml(ev.summary)}</div>
          <span class="task-proj-chip" style="background:rgba(${CAL_COLOR},0.16);color:rgb(${CAL_COLOR})">${calEventTimeLabel(ev)}</span>
        </div>
      </div>`;
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

// 並び順:
//   - カレンダーの終日予定が一番上
//   - 次にカレンダーの時刻予定（時刻順）
//   - 最後にタスク（createdAt 昇順 = 古い=入れた順）
export function renderTodayTimeline(tasks, calEvents = [], projects = []) {
  if (tasks.length === 0 && calEvents.length === 0) {
    return '<div class="empty-state">この日の予定はありません</div>';
  }
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const sortedTasks = [...tasks].sort((a, b) => {
    const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0;
    const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0;
    return ta - tb;
  });
  const cal = [...calEvents].sort((a, b) => {
    if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
    return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
  });
  const html = [
    ...cal.map((ev) => renderCalEventCard(ev)),
    ...sortedTasks.map((t) => renderTaskCard(t, projectMap)),
  ];
  return html.join("");
}
