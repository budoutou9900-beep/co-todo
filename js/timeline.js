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

export function renderTodayTaskList(tasks) {
  if (tasks.length === 0) {
    return '<div class="empty-state">この日のタスクはありません</div>';
  }
  const sorted = [...tasks].sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  return sorted
    .map((t) => {
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
    })
    .join("");
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
