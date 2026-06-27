import { watchAuth, signIn, signOutUser } from "./auth.js";
import { subscribeToTasks, subscribeToProjects, addTask, updateTask, addProject, updateProject } from "./db.js";
import { completeTask, checkDateReset } from "./tasks.js";
import { renderWeekStrip, renderWeekView, locToJp, jpToLoc, PLACE_LABELS } from "./calendar.js";
import { renderTodayTimeline, repeatToLabel } from "./timeline.js";
import { isConnected, connectCalendar, disconnectCalendar, fetchEvents, getLastFetchInfo } from "./calendar-sync.js";
import { PLACE_COLORS, hexToRgb, todayStr, formatHeaderDate, startOfWeek, addDays, escapeHtml } from "./utils.js";

const state = {
  user: null,
  tasks: [],
  projects: [],
  view: "today",
  selectedDate: todayStr(),
  weekStart: startOfWeek(todayStr()),
  filter: "全て",
  ritual: { open: false, step: 1, location: null, picks: [] },
  sheet: { open: false, editingId: null, draft: null },
  toastMsg: null,
  unsubTasks: null,
  unsubProjects: null,
  calendarConnected: isConnected(),
  calendarEvents: [],
  calendarDate: null,
};

const PROJECT_COLORS = ["#9580ff", "#5b8aff", "#d4a558", "#4ecf8a", "#ff7c5c"];

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

let toastTimer = null;
function flash(msg) {
  state.toastMsg = msg;
  renderToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    state.toastMsg = null;
    renderToast();
  }, 1600);
}

function renderToast() {
  const c = $("#toast-container");
  c.innerHTML = state.toastMsg ? `<div class="toast">${escapeHtml(state.toastMsg)}</div>` : "";
}

// ---------- auth ----------
watchAuth(
  async (user) => {
    state.user = user;
    if (user) {
      $("#login-screen").style.display = "none";
      $("#app-screen").style.display = "flex";
      startSubscriptions();
      if (state.calendarConnected) waitForGisThenRefresh();
    } else {
      $("#login-screen").style.display = "flex";
      $("#app-screen").style.display = "none";
      if (state.unsubTasks) state.unsubTasks();
      if (state.unsubProjects) state.unsubProjects();
    }
  },
  (err) => {
    const el = $("#login-error");
    if (el) el.textContent = `ログインエラー: ${err.code || ""} ${err.message || err}`;
  }
);

$("#login-btn").addEventListener("click", () => signIn().catch((e) => alert("ログインに失敗しました: " + e.message)));
$("#signout-btn").addEventListener("click", () => signOutUser());

function startSubscriptions() {
  state.unsubTasks = subscribeToTasks(async (tasks) => {
    state.tasks = tasks;
    await checkDateReset(tasks);
    requestRender();
  });
  state.unsubProjects = subscribeToProjects((projects) => {
    state.projects = projects;
    requestRender();
  });
}

// ---------- tab navigation ----------
$$(".tab-item").forEach((el) => {
  el.addEventListener("click", () => {
    if (el.dataset.action === "ritual") {
      openRitualFromTab();
      return;
    }
    state.view = el.dataset.view;
    renderScreen();
    updateTabBar();
  });
});
// 中央の浮きボタン（今日）も view 切替
$("#go-today-btn").addEventListener("click", () => {
  state.view = "today";
  renderScreen();
  updateTabBar();
});

function openRitualFromTab() {
  state.ritual = { open: true, step: 1, location: null, picks: [] };
  renderRitual();
}

function updateTabBar() {
  const active = "#9580ff";
  const idle = "rgba(240,240,245,0.28)";
  // 中央の浮き丸ボタン（今日）の見た目を view==='today' でハイライト
  const todayBtn = $("#go-today-btn");
  if (todayBtn) {
    const on = state.view === "today";
    todayBtn.style.borderColor = on ? "rgba(149,128,255,0.55)" : "rgba(149,128,255,0.32)";
    todayBtn.style.background = on ? "rgba(149,128,255,0.22)" : "rgba(149,128,255,0.12)";
  }
  ["week", "projects"].forEach((v) => {
    const isActive = state.view === v;
    $(`#tab-icon-${v}`).style.color = isActive ? active : idle;
    const label = $(`[data-label="${v}"]`);
    label.style.color = isActive ? active : idle;
    label.style.fontWeight = isActive ? "600" : "400";
  });
}

// ---------- screen rendering ----------
let lastRenderedHtml = null;
function renderScreen() {
  const content = $("#screen-content");
  let html;
  if (state.view === "today") html = renderTodayScreen();
  else if (state.view === "week") html = renderWeekScreen();
  else html = renderProjectsScreen();
  // 同じHTMLなら DOM を作り直さない。Firestoreが同一データで再通知しても
  // ノードが再生成されず、進行中のアニメ（checkdraw）が乱れない。
  if (html === lastRenderedHtml) return;
  lastRenderedHtml = html;
  content.innerHTML = html;
  wireScreenEvents();
}

// Firestoreの onSnapshot は1操作で複数回（ローカル反映＋サーバー確定＋
// 繰り返しタスクの追加など）短時間に連続発火する。そのたびに画面全体を
// 作り直すと checkdraw アニメが途中で再起動して「ぶれる」ため、
// requestAnimationFrame で1フレームに集約して1回だけ描画する。
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderScreen();
  });
}

function renderTodayScreen() {
  const dayTasks = state.tasks.filter((t) => t.date === state.selectedDate);
  const doneN = dayTasks.filter((t) => t.done).length;
  // カレンダー予定は選択日のものだけ表示（取得済みの日付が一致するとき）
  const events = state.calendarConnected && state.calendarDate === state.selectedDate ? state.calendarEvents : [];
  const calChip = state.calendarConnected
    ? `<div id="cal-toggle" class="cal-chip on">📅 カレンダー</div>`
    : `<div id="cal-toggle" class="cal-chip">📅 連携</div>`;
  return `
    <div class="screen">
      <div class="screen-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="eyebrow">TODAY</div>
            <div class="title-lg">${formatHeaderDate(state.selectedDate)}</div>
          </div>
          <div style="font-size:11.5px;color:rgba(240,240,245,0.35);padding-top:8px">残り${dayTasks.length - doneN}件</div>
        </div>
      </div>
      <div class="week-strip" id="week-strip">${renderWeekStrip(state.tasks, state.selectedDate)}</div>
      <div class="timeline-label-row">
        <div class="timeline-label">タイムライン</div>
        <div style="display:flex;align-items:center;gap:10px">
          ${calChip}
          <div class="timeline-done">${doneN} / ${dayTasks.length} 完了</div>
        </div>
      </div>
      <div class="task-list-scroll scroll">
        <div class="task-list-pad">${renderTodayTimeline(dayTasks, events)}</div>
      </div>
    </div>`;
}

function renderWeekScreen() {
  const { html, total } = renderWeekView(state.tasks, state.weekStart, state.filter);
  const weekEndDay = addDays(state.weekStart, 6);
  const rangeLabel = `${new Date(state.weekStart + "T00:00:00").getMonth() + 1}月 ${new Date(
    state.weekStart + "T00:00:00"
  ).getDate()}–${new Date(weekEndDay + "T00:00:00").getDate()}`;
  const filters = ["全て", ...PLACE_LABELS];
  const filterChips = filters
    .map((f) => {
      const on = state.filter === f;
      const c = f === "全て" ? "#9580ff" : PLACE_COLORS[f];
      const [r, g, b] = hexToRgb(c);
      const style = on
        ? `background:${c};color:#fff;font-weight:500`
        : `background:rgba(${r},${g},${b},0.1);border:1px solid rgba(${r},${g},${b},0.22);color:rgba(${r},${g},${b},0.75)`;
      return `<div class="filter-chip" data-filter="${f}" style="${style}">${f}</div>`;
    })
    .join("");
  return `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:12px">
        <div class="eyebrow muted">THIS WEEK</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div class="title-md">${rangeLabel}</div>
          <div style="font-size:11.5px;color:rgba(240,240,245,0.32)">${total}件</div>
        </div>
      </div>
      <div class="filter-row scroll">${filterChips}</div>
      <div class="task-list-scroll scroll" style="padding:0 16px 120px">
        ${html || '<div class="empty-state">該当するタスクはありません</div>'}
      </div>
    </div>`;
}

function renderProjectsScreen() {
  const cards = state.projects
    .map((p) => {
      const subs = state.tasks.filter((t) => t.projectId === p.id);
      const doneN = subs.filter((t) => t.done).length;
      const pct = subs.length ? Math.round((doneN / subs.length) * 100) : 0;
      const [r, g, b] = hexToRgb(p.color || "#9580ff");
      const dueWarn = p.dueDate && p.dueDate < todayStr();
      const subRows = subs
        .map((t) => {
          const checkStyle = t.done
            ? `background:rgba(${r},${g},${b},0.9)`
            : `border:1.3px solid rgba(${r},${g},${b},0.4)`;
          const textStyle = t.done
            ? `color:rgba(240,240,245,0.4);text-decoration:line-through;text-decoration-color:rgba(${r},${g},${b},0.4)`
            : "color:rgba(240,240,245,0.78)";
          return `
          <div class="subtask-row" data-task-id="${t.id}">
            <div class="subtask-check" style="${checkStyle}">${
            t.done
              ? '<svg width="8" height="6" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 .5" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg>'
              : ""
          }</div>
            <div class="subtask-text" style="${textStyle}">${escapeHtml(t.title)}</div>
          </div>`;
        })
        .join("");
      return `
      <div class="project-card" data-project-id="${p.id}">
        <div class="project-top-bar" style="background:linear-gradient(90deg,${p.color},rgba(${r},${g},${b},0.3))"></div>
        <div class="project-header-row" data-toggle-project="${p.id}">
          <div>
            <div class="project-name">${escapeHtml(p.title)}</div>
            <div class="project-sub">${subs.length}個のタスク</div>
          </div>
          <div style="text-align:right">
            <div class="project-pct" style="color:${p.color}">${pct}%</div>
            <div class="project-pct-label">完了</div>
          </div>
        </div>
        <div class="project-bar-track">
          <div class="project-bar-fill" style="width:${pct}%;background:linear-gradient(90deg,${p.color},rgba(${r},${g},${b},0.65));box-shadow:0 0 8px rgba(${r},${g},${b},0.5)"></div>
        </div>
        <div class="project-footer-row">
          <div class="project-footer-left">
            <div>
              <div class="project-stat-val">${doneN} / ${subs.length}</div>
              <div class="project-stat-label">タスク完了</div>
            </div>
            <div>
              <div class="project-due" style="color:${dueWarn ? "var(--warn)" : "rgba(240,240,245,0.65)"}">${
        p.dueDate || "—"
      }</div>
              <div class="project-stat-label">締切</div>
            </div>
          </div>
          <div class="project-expand-hint">${p.open ? "閉じる ▲" : "開く ▼"}</div>
        </div>
        ${
          p.open
            ? `<div class="project-subtasks">${subRows || '<div class="project-stat-label">小タスクなし</div>'}
              <div class="add-subtask-btn" data-add-subtask="${p.id}">＋ 小タスクを追加</div>
            </div>`
            : ""
        }
      </div>`;
    })
    .join("");
  return `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:14px">
        <div class="eyebrow muted">PROJECTS</div>
        <div class="title-md">大タスク</div>
      </div>
      <div class="task-list-scroll scroll" style="padding:0 16px 120px">
        ${cards}
        <div class="add-project-btn" id="add-project-btn">＋ 大タスクを追加</div>
      </div>
    </div>`;
}

function wireScreenEvents() {
  // today: week strip date pick
  $$(".week-strip-col").forEach((el) => {
    el.addEventListener("click", () => {
      state.selectedDate = el.dataset.date;
      renderScreen();
      if (state.calendarConnected) refreshCalendar(state.selectedDate);
    });
  });
  // today: calendar 連携トグル
  const calToggle = $("#cal-toggle");
  if (calToggle) calToggle.addEventListener("click", onCalendarToggle);
  // today: タスク行 = タップで編集、チェック領域だけ完了トグル
  $$(".task-row").forEach((el) => {
    const taskId = el.dataset.taskId;
    if (!taskId) return; // カレンダー予定は読み取り専用
    const check = el.querySelector(".task-check");
    if (check) {
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTask(taskId);
      });
    }
    el.addEventListener("click", () => openSheet({ taskId }));
  });
  // week: filter chips
  $$(".filter-chip").forEach((el) => {
    el.addEventListener("click", () => {
      state.filter = el.dataset.filter;
      renderScreen();
    });
  });
  // week: タップで編集
  $$(".week-task-row").forEach((el) => {
    el.addEventListener("click", () => openSheet({ taskId: el.dataset.taskId }));
  });
  // projects: toggle open
  $$("[data-toggle-project]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.toggleProject;
      const p = state.projects.find((x) => x.id === id);
      p.open = !p.open;
      renderScreen();
    });
  });
  // projects: 小タスク = タップで編集、チェックだけ完了トグル
  $$(".subtask-row").forEach((el) => {
    const taskId = el.dataset.taskId;
    const check = el.querySelector(".subtask-check");
    if (check) {
      check.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleTask(taskId);
      });
    }
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openSheet({ taskId });
    });
  });
  // projects: 小タスクを追加
  $$("[data-add-subtask]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      openSheet({ projectId: el.dataset.addSubtask });
    });
  });
  const addProjBtn = $("#add-project-btn");
  if (addProjBtn) addProjBtn.addEventListener("click", () => openAddProjectPrompt());
}

async function toggleTask(taskId) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) return;
  if (!task.done) {
    await completeTask(task);
    flash("完了 — おつかれさま ✦");
  } else {
    await updateTask(taskId, { done: false });
  }
}

// ---------- Google カレンダー連携 ----------
async function onCalendarToggle() {
  if (state.calendarConnected) {
    disconnectCalendar();
    state.calendarConnected = false;
    state.calendarEvents = [];
    state.calendarDate = null;
    renderScreen();
    flash("カレンダー連携を解除しました");
    return;
  }
  try {
    await connectCalendar();
    state.calendarConnected = true;
    renderScreen();
    await refreshCalendar(state.selectedDate, true);
  } catch (e) {
    flash("連携失敗: " + (e?.message || e?.error || e));
  }
}

// GISスクリプト(accounts.google.com/gsi/client)は async 読み込みのため、
// ログイン直後の自動取得では読み込み完了を最大5秒待ってから silent 取得する。
function waitForGisThenRefresh(attempt = 0) {
  if (typeof google !== "undefined" && google.accounts?.oauth2) {
    refreshCalendar(state.selectedDate);
    return;
  }
  if (attempt >= 25) return; // 約5秒で諦める（次のユーザー操作で再試行される）
  setTimeout(() => waitForGisThenRefresh(attempt + 1), 200);
}

async function refreshCalendar(dateStr, notify = false) {
  if (!state.calendarConnected) return;
  try {
    const events = await fetchEvents(dateStr);
    state.calendarEvents = events;
    state.calendarDate = dateStr;
    if (state.view === "today") renderScreen();
    if (notify) {
      const info = getLastFetchInfo();
      flash(
        events.length
          ? `予定 ${events.length} 件（${info.calendars}カレンダー）`
          : `この日の予定なし（${info.calendars}カレンダー確認）`
      );
    }
  } catch (e) {
    console.error("カレンダー取得エラー", e);
    flash("予定取得エラー: " + (e?.message || e?.error || e));
  }
}

async function openAddProjectPrompt() {
  const title = prompt("大タスク名を入力してください");
  if (!title || !title.trim()) return;
  const dueDate = prompt("締切日（YYYY-MM-DD、なければ空欄）") || null;
  const color = PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length];
  await addProject({ title: title.trim(), color, dueDate: dueDate || null, open: true });
  flash("大タスクを追加しました");
}

// ---------- ritual mode ----------
const LOCATIONS = [
  { name: "研究室", desc: "大学・図書館など", color: "#9580ff" },
  { name: "家", desc: "自宅で集中作業", color: "#5b8aff" },
  { name: "移動中", desc: "電車・バス・外出先", color: "#d4a558" },
];

// 儀式モードは「First」タブから openRitualFromTab() で起動する

function closeRitual() {
  state.ritual.open = false;
  renderRitual();
}

function renderRitual() {
  const c = $("#ritual-container");
  if (!state.ritual.open) {
    c.innerHTML = "";
    return;
  }
  const r = state.ritual;
  c.innerHTML =
    r.step === 1 ? renderRitualStep1() : renderRitualStep2();
  wireRitualEvents();
}

function renderRitualStep1() {
  const locCards = LOCATIONS.map((loc) => {
    const sel = state.ritual.location === loc.name;
    const [r, g, b] = hexToRgb(loc.color);
    const cardStyle = sel
      ? `background:rgba(${r},${g},${b},0.1);border:1.5px solid rgba(${r},${g},${b},0.45);box-shadow:0 0 18px rgba(${r},${g},${b},0.12)`
      : `background:var(--surface);border:1px solid rgba(255,255,255,0.07)`;
    const radioStyle = sel
      ? `background:${loc.color}`
      : `border:1.5px solid rgba(255,255,255,0.15)`;
    return `
    <div class="loc-card" data-loc="${loc.name}" style="${cardStyle}">
      <div class="loc-icon-wrap" style="background:rgba(${r},${g},${b},0.16)"><div style="width:9px;height:9px;border-radius:50%;background:${loc.color}"></div></div>
      <div style="flex:1">
        <div class="loc-name" style="${sel ? "color:#f0f0f5" : "color:rgba(240,240,245,0.6)"}">${loc.name}</div>
        <div class="loc-desc">${loc.desc}</div>
      </div>
      <div class="loc-radio" style="${radioStyle}">${
      sel
        ? '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-6.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        : ""
    }</div>
    </div>`;
  }).join("");
  const hasLoc = !!state.ritual.location;
  const btnStyle = hasLoc
    ? "background:linear-gradient(135deg,#9a82ff,#7b5fff);box-shadow:0 0 24px rgba(149,128,255,0.35)"
    : "background:rgba(149,128,255,0.2)";
  return `
    <div class="ritual-overlay">
      <div class="ritual-glow"></div>
      <div class="ritual-top-pad"></div>
      <div class="ritual-header">
        <div class="ritual-eyebrow">MORNING RITUAL</div>
        <div class="ritual-close" id="ritual-close-btn"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="rgba(240,240,245,0.55)" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      </div>
      <div class="ritual-step">
        <div class="ritual-greeting-block">
          <div class="ritual-greeting">おはよう。</div>
          <div class="ritual-sub">今日、どこにいる？</div>
        </div>
        <div class="ritual-locations">${locCards}</div>
        <div class="ritual-spacer"></div>
        <div class="ritual-btn-wrap">
          <div class="ritual-btn" id="ritual-next-btn" style="${btnStyle}">
            <div class="ritual-btn-title">次へ</div>
          </div>
        </div>
      </div>
    </div>`;
}

function renderRitualStep2() {
  const loc = state.ritual.location;
  const today = todayStr();
  const candidates = state.tasks.filter((t) => locToJp(t.location) === loc && !t.done && (t.date === today || isRepeatDueToday(t) || !t.date));
  const picks = state.ritual.picks;
  const cards = candidates
    .map((t) => {
      const sel = picks.includes(t.id);
      const full = picks.length >= 3 && !sel;
      const place = locToJp(t.location);
      const [r, g, b] = hexToRgb(PLACE_COLORS[place] || PLACE_COLORS.研究室);
      const meta = (repeatToLabel(t.repeat) ? `↻ ${repeatToLabel(t.repeat)}` : "単発") + (t.time ? " · " + t.time : "");
      return `
      <div class="cand-card" data-cand-id="${t.id}" style="border:1px solid ${sel ? `rgba(${r},${g},${b},0.5)` : "rgba(255,255,255,0.06)"};opacity:${full ? 0.45 : 1}">
        <div class="cand-check" style="${sel ? `background:${PLACE_COLORS[place]}` : "border:1.5px solid rgba(255,255,255,0.2)"}">${
        sel
          ? '<svg width="11" height="9" viewBox="0 0 11 9" fill="none"><path d="M1 4.5l3 3 6-6.5" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : ""
      }</div>
        <div style="flex:1">
          <div class="cand-title">${escapeHtml(t.title)}</div>
          <div class="cand-meta">${meta}</div>
        </div>
        <span class="place-tag" style="${`background:rgba(${r},${g},${b},0.16);color:${PLACE_COLORS[place]}`}">${place}</span>
      </div>`;
    })
    .join("");
  const startStyle = picks.length
    ? "background:linear-gradient(135deg,#9a82ff,#7b5fff);box-shadow:0 0 26px rgba(149,128,255,0.38)"
    : "background:rgba(149,128,255,0.2)";
  return `
    <div class="ritual-overlay">
      <div class="ritual-glow"></div>
      <div class="ritual-top-pad"></div>
      <div class="ritual-header">
        <div class="ritual-eyebrow">MORNING RITUAL</div>
        <div class="ritual-close" id="ritual-close-btn"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="rgba(240,240,245,0.55)" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      </div>
      <div class="ritual-step">
        <div class="ritual-greeting-block">
          <div class="ritual-step2-title">${escapeHtml(loc)}での今日。</div>
          <div class="ritual-sub" style="font-size:13px">最大3つ選んで始めよう</div>
        </div>
        <div class="ritual-candidates-scroll scroll">
          ${cards || '<div class="empty-state">候補タスクがありません</div>'}
          <div class="pick-count-label">${picks.length} / 3 選択中</div>
        </div>
        <div class="ritual-btn-wrap">
          <div class="ritual-btn" id="ritual-start-btn" style="${startStyle}">
            <div class="ritual-btn-title">今日スタート</div>
            <div class="ritual-btn-sub">${picks.length ? `${picks.length}件のタスクで始める` : "タスクを選んでください"}</div>
          </div>
        </div>
      </div>
    </div>`;
}

function isRepeatDueToday(t) {
  return t.repeat && t.repeat.type !== "none" && t.date === todayStr();
}

function wireRitualEvents() {
  const closeBtn = $("#ritual-close-btn");
  if (closeBtn) closeBtn.addEventListener("click", closeRitual);

  $$(".loc-card").forEach((el) => {
    el.addEventListener("click", () => {
      state.ritual.location = el.dataset.loc;
      renderRitual();
    });
  });
  const nextBtn = $("#ritual-next-btn");
  if (nextBtn)
    nextBtn.addEventListener("click", () => {
      if (!state.ritual.location) {
        flash("場所を選んでください");
        return;
      }
      state.ritual.step = 2;
      renderRitual();
    });

  $$(".cand-card").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.candId;
      const picks = state.ritual.picks;
      const sel = picks.includes(id);
      if (!sel && picks.length >= 3) {
        flash("最大3つまでです");
        return;
      }
      state.ritual.picks = sel ? picks.filter((x) => x !== id) : [...picks, id];
      renderRitual();
    });
  });
  const startBtn = $("#ritual-start-btn");
  if (startBtn)
    startBtn.addEventListener("click", async () => {
      const picks = state.ritual.picks;
      const today = todayStr();
      for (const id of picks) {
        await updateTask(id, { date: today });
      }
      const n = picks.length;
      state.ritual.open = false;
      state.view = "today";
      state.selectedDate = today;
      renderRitual();
      renderScreen();
      updateTabBar();
      flash(`${n}件のタスクで今日を始めます ✦`);
    });
}

// ---------- bottom sheet (add/edit task) ----------
const REPEAT_OPTIONS = [
  { type: "none", label: "なし" },
  { type: "weekly", label: "毎週金曜日", days: [5] },
  { type: "interval", label: "3日ごと", interval: 3 },
  { type: "interval", label: "毎日", interval: 1 },
];
const TIMES = ["", "9:00", "10:00", "11:00", "14:00", "19:00"];

$("#open-sheet-btn").addEventListener("click", () => openSheet());

function defaultDraft() {
  return {
    title: "",
    date: state.selectedDate,
    time: "",
    repeatIndex: 0,
    places: [],
    projectIndex: 0,
    reset: false,
  };
}

// 引数: { taskId } で編集モード、{ projectId } で新規（プロジェクトをプリセット）。
// 引数なし or 空オブジェクトで通常の新規追加。
function openSheet(opts = {}) {
  const { taskId, projectId } = opts;
  if (taskId) {
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    state.sheet = {
      open: true,
      editingId: taskId,
      draft: {
        title: t.title,
        date: t.date || state.selectedDate,
        time: t.time || "",
        repeatIndex: Math.max(
          0,
          REPEAT_OPTIONS.findIndex((r) => r.type === (t.repeat?.type || "none"))
        ),
        places: t.location ? [locToJp(t.location)] : [],
        projectIndex: t.projectId ? state.projects.findIndex((p) => p.id === t.projectId) + 1 : 0,
        reset: !!t.autoResetDate,
      },
    };
  } else {
    const draft = defaultDraft();
    if (projectId) {
      const idx = state.projects.findIndex((p) => p.id === projectId);
      if (idx >= 0) draft.projectIndex = idx + 1;
    }
    state.sheet = { open: true, editingId: null, draft };
  }
  renderSheet(true);
  // タイトルにフォーカス（モバイルでもキーボードが開くよう少し遅延）
  setTimeout(() => $("#draft-title-input")?.focus(), 50);
}

function closeSheet() {
  state.sheet = { open: false, editingId: null, draft: null };
  renderSheet();
}

function renderSheet(animate = false) {
  const c = $("#sheet-container");
  if (!state.sheet.open) {
    c.innerHTML = "";
    return;
  }
  const d = state.sheet.draft;
  const isEdit = !!state.sheet.editingId;
  const placesPills = ["研究室", "家", "移動中"]
    .map((name) => {
      const on = d.places.includes(name);
      const c = PLACE_COLORS[name];
      const [r, g, b] = hexToRgb(c);
      const style = on
        ? `background:rgba(${r},${g},${b},0.18);border:1.5px solid rgba(${r},${g},${b},0.45);color:${c}`
        : `background:rgba(${r},${g},${b},0.08);border:1px solid rgba(${r},${g},${b},0.18);color:rgba(${r},${g},${b},0.55)`;
      return `<div class="place-pill" data-place="${name}" style="${style}">${name}</div>`;
    })
    .join("");
  const projNames = ["なし", ...state.projects.map((p) => p.title)];
  const projColors = ["rgba(255,255,255,0.2)", ...state.projects.map((p) => p.color)];
  const titleOk = d.title && d.title.trim();
  c.innerHTML = `
    <div class="sheet-overlay${animate ? " animate-in" : ""}">
      <div class="sheet-backdrop" id="sheet-backdrop"></div>
      <div class="sheet scroll">
        <div class="sheet-handle-wrap"><div class="sheet-handle"></div></div>
        <div class="sheet-header">
          <div class="sheet-cancel" id="sheet-cancel-btn">キャンセル</div>
          <div class="sheet-title">${isEdit ? "タスクを編集" : "タスクを追加"}</div>
          <div class="sheet-save" id="sheet-save-btn" style="color:${titleOk ? "#9580ff" : "rgba(149,128,255,0.4)"}">保存</div>
        </div>
        <div class="sheet-body">
          <div class="field-title">
            <div class="field-label">タイトル</div>
            <input id="draft-title-input" class="field-input" placeholder="タスク名を入力" value="${escapeHtml(d.title)}" enterkeyhint="next" autocomplete="off" />
          </div>
          <div class="field-row2">
            <div class="field-box">
              <div class="field-box-label">日付</div>
              <input type="date" id="draft-date-input" class="date-input-native" value="${d.date || ""}" />
            </div>
            <div class="field-box" id="draft-time-box">
              <div class="field-box-label">時間</div>
              <div class="field-box-val">${d.time || "時間未定"}</div>
            </div>
          </div>
          <div class="field-tappable" id="draft-repeat-box">
            <div>
              <div class="field-box-label">繰り返し</div>
              <div class="field-box-val-sm">${REPEAT_OPTIONS[d.repeatIndex].label}</div>
            </div>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 6a4 4 0 014-4h2M10 6a4 4 0 01-4 4H4" stroke="rgba(149,128,255,0.6)" stroke-width="1.3" stroke-linecap="round"/><path d="M8 1l2 1.5-2 1.5M4 8L2 9.5 4 11" stroke="rgba(149,128,255,0.6)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="field-places">
            <div class="field-places-label">場所タグ</div>
            <div class="field-places-row">${placesPills}</div>
          </div>
          <div class="field-tappable" id="draft-project-box">
            <div>
              <div class="field-box-label">大タスクに紐づけ</div>
              <div class="field-proj-row">
                <div class="proj-dot" style="background:${projColors[d.projectIndex]}"></div>
                <div style="font-size:13.5px">${escapeHtml(projNames[d.projectIndex])}</div>
              </div>
            </div>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M3 4.5l3 3 3-3" stroke="rgba(149,128,255,0.5)" stroke-width="1.3" stroke-linecap="round"/></svg>
          </div>
          <div class="field-toggle-row" id="draft-reset-toggle">
            <div>
              <div class="toggle-title">完了時リセット</div>
              <div class="toggle-sub">完了後に次回へ自動移動</div>
            </div>
            <div class="toggle-track" style="background:${d.reset ? "#9580ff" : "rgba(255,255,255,0.12)"};box-shadow:${
    d.reset ? "0 0 10px rgba(149,128,255,0.4)" : "none"
  }">
              <div class="toggle-thumb" style="${d.reset ? "right:3px" : "left:3px"}"></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  wireSheetEvents();
}

function wireSheetEvents() {
  $("#sheet-backdrop").addEventListener("click", closeSheet);
  $("#sheet-cancel-btn").addEventListener("click", closeSheet);
  const titleInput = $("#draft-title-input");
  titleInput.addEventListener("input", (e) => {
    state.sheet.draft.title = e.target.value;
    $("#sheet-save-btn").style.color = e.target.value.trim() ? "#9580ff" : "rgba(149,128,255,0.4)";
  });
  titleInput.addEventListener("keydown", (e) => {
    // IME変換中のEnter（confirm）は無視する
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    state.sheet.draft.title = e.target.value;
    saveDraftAndContinue();
  });
  $("#draft-date-input").addEventListener("change", (e) => {
    state.sheet.draft.date = e.target.value || null;
  });
  $("#draft-time-box").addEventListener("click", () => {
    const i = TIMES.indexOf(state.sheet.draft.time);
    state.sheet.draft.time = TIMES[(i + 1) % TIMES.length];
    renderSheet();
  });
  $("#draft-repeat-box").addEventListener("click", () => {
    state.sheet.draft.repeatIndex = (state.sheet.draft.repeatIndex + 1) % REPEAT_OPTIONS.length;
    renderSheet();
  });
  $$(".place-pill").forEach((el) => {
    el.addEventListener("click", () => {
      const name = el.dataset.place;
      const places = state.sheet.draft.places;
      state.sheet.draft.places = places.includes(name) ? [] : [name];
      renderSheet();
    });
  });
  $("#draft-project-box").addEventListener("click", () => {
    const total = state.projects.length + 1;
    state.sheet.draft.projectIndex = (state.sheet.draft.projectIndex + 1) % total;
    renderSheet();
  });
  $("#draft-reset-toggle").addEventListener("click", () => {
    state.sheet.draft.reset = !state.sheet.draft.reset;
    renderSheet();
  });
  $("#sheet-save-btn").addEventListener("click", saveDraftTask);
}

// draftをFirestoreに書き込む。成功すればtrueを返す。
async function commitDraft() {
  const d = state.sheet.draft;
  if (!d.title || !d.title.trim()) {
    flash("タイトルを入力してください");
    return false;
  }
  const repeatOpt = REPEAT_OPTIONS[d.repeatIndex];
  const place = d.places[0] || null;
  const projIdx = d.projectIndex;
  const projectId = projIdx > 0 ? state.projects[projIdx - 1].id : null;
  const payload = {
    title: d.title.trim(),
    date: d.date || null,
    time: d.time || null,
    duration: 60,
    location: place ? jpToLoc(place) : null,
    projectId,
    repeat: {
      type: repeatOpt.type,
      days: repeatOpt.days || [],
      interval: repeatOpt.interval || 0,
    },
    autoResetDate: d.reset,
  };
  if (state.sheet.editingId) {
    await updateTask(state.sheet.editingId, payload);
    flash("タスクを更新しました");
  } else {
    await addTask(payload);
    flash("タスクを追加しました");
  }
  return true;
}

async function saveDraftTask() {
  if (await commitDraft()) closeSheet();
}

// Enter キーで保存して連続入力。シートは閉じず、タイトルだけクリアして
// 他のフィールド（日付・場所・プロジェクト・繰り返し・リセット）は維持する。
async function saveDraftAndContinue() {
  if (state.sheet.editingId) {
    // 編集モード中はEnterで通常保存（次へではなく確定）
    if (await commitDraft()) closeSheet();
    return;
  }
  if (!(await commitDraft())) return;
  state.sheet.draft = { ...state.sheet.draft, title: "" };
  renderSheet(); // animate-in なしで再描画
  setTimeout(() => $("#draft-title-input")?.focus(), 0);
}

// ---------- init ----------
updateTabBar();
