import { watchAuth, signIn, signOutUser } from "./auth.js";
import { subscribeToTasks, subscribeToProjects, addTask, updateTask, addProject, updateProject, deleteTask, deleteProject } from "./db.js";
import { completeTask } from "./tasks.js";
import { renderWeekView, renderMonthCalendar } from "./calendar.js";
import { renderTodayTimeline, taskSortKey } from "./timeline.js";
import { attachDragSort, detachDragSort, isDragActive } from "./drag.js";
import { attachSwipeToDelete, detachAllSwipe, isSwipeActive } from "./swipe.js";
import { isConnected, connectCalendar, disconnectCalendar, fetchEvents, fetchEventsRange, getLastFetchInfo } from "./calendar-sync.js";
import { hexToRgb, todayStr, toDateStr, formatHeaderDate, addDays, escapeHtml, isLongTermProject } from "./utils.js";

const state = {
  user: null,
  tasks: [],
  projects: [],
  view: "today",
  selectedDate: todayStr(),
  projectTab: "short",
  sheet: { open: false, editingId: null, draft: null },
  toastMsg: null,
  unsubTasks: null,
  unsubProjects: null,
  calendarConnected: isConnected(),
  calendarEvents: [],
  calendarDate: null,
  doneCollapsed: true,
  // 今週タブの月カレンダー
  weekCalAnchor: todayStr(), // 表示中の月の基準日
  weekCalEventsByDate: {}, // { "YYYY-MM-DD": [ev,...] }
  weekCalLoadedMonth: null, // 取得済みの月キー "YYYY-MM"
  weekDetailDate: null, // 今週タブ内で選択中の日付詳細（月カレンダーの日付タップで設定）
};

const PROJECT_COLORS = [
  "#9580ff", "#5b8aff", "#4ecf8a", "#d4a558", "#ff7c5c",
  "#ff5c9e", "#5cd6ff", "#c5e05c", "#e0985c", "#8a5cff",
  "#5cffcf", "#ff5c5c", "#ffd166", "#7ed957", "#42a5f5",
  "#7986cb", "#e066ff", "#ff85a2", "#26c6da", "#a0785a",
];

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
  state.unsubTasks = subscribeToTasks((tasks) => {
    state.tasks = tasks;
    carryOverOverdueTasks();
    requestRender();
  });
  state.unsubProjects = subscribeToProjects((projects) => {
    state.projects = projects;
    requestRender();
  });
}

// 期限切れの未完了タスクを今日に引き継ぐ。
// - 対象: date が今日より前 かつ 未完了 かつ 繰り返しなし
// - date を今日に上書き（元の日付は残さないシンプル方式）
// - 更新後はそのタスクの date が今日になるため再実行で再マッチしない
let carryOverRunning = false;
async function carryOverOverdueTasks() {
  if (carryOverRunning) return;
  const today = todayStr();
  const overdue = state.tasks.filter(
    (t) => !t.done && t.date && t.date < today && (!t.repeat || t.repeat.type === "none")
  );
  if (overdue.length === 0) return;
  carryOverRunning = true;
  try {
    await Promise.all(overdue.map((t) => updateTask(t.id, { date: today })));
  } catch (e) {
    console.error("タスクの引き継ぎに失敗:", e);
  } finally {
    carryOverRunning = false;
  }
}

// ---------- tab navigation ----------
$$(".tab-item").forEach((el) => {
  el.addEventListener("click", () => {
    state.view = el.dataset.view;
    renderScreen();
    updateTabBar();
    // 今週タブに来たら月カレンダーの予定を取得（連携済みのとき）
    if (state.view === "week") refreshWeekCalendar();
  });
});

function updateTabBar() {
  const active = "#9580ff";
  const idle = "rgba(240,240,245,0.28)";
  ["today", "week", "projects"].forEach((v) => {
    const isActive = state.view === v;
    $(`#tab-icon-${v}`).style.color = isActive ? active : idle;
    const label = $(`[data-label="${v}"]`);
    label.style.color = isActive ? active : idle;
    label.style.fontWeight = isActive ? "600" : "400";
  });
  // プロジェクト追加FABはプロジェクトタブのときだけ表示
  const projFab = $("#add-project-fab");
  if (projFab) projFab.style.display = state.view === "projects" ? "flex" : "none";
}

// ---------- screen rendering ----------
let lastRenderedHtml = null;
let lastRenderedView = null;
function renderScreen() {
  const content = $("#screen-content");
  let html;
  if (state.view === "today") html = renderTodayScreen();
  else if (state.view === "week") html = renderWeekScreen();
  else html = renderProjectsScreen();
  // 同じHTMLなら DOM を作り直さない。Firestoreが同一データで再通知しても
  // ノードが再生成されず、進行中のアニメ（checkdraw）が乱れない。
  if (html === lastRenderedHtml) return;
  // 同じビュー内の再描画では、ユーザーがスクロールしていた位置を保持する。
  // ビューを切り替えたときは先頭に戻す。
  const keepScroll = lastRenderedView === state.view;
  const prevScroll = keepScroll ? $(".task-list-scroll")?.scrollTop ?? 0 : 0;
  lastRenderedHtml = html;
  lastRenderedView = state.view;
  content.innerHTML = html;
  // ビュー切替のときだけフェードイン。同一ビューのデータ更新では付けない
  // （タスク完了などの再描画で画面全体が一瞬暗くなるのを防ぐ）。
  if (!keepScroll) $(".screen")?.classList.add("screen-enter");
  wireScreenEvents();
  if (keepScroll) {
    const sc = $(".task-list-scroll");
    if (sc) sc.scrollTop = prevScroll;
  }
}

// Firestoreの onSnapshot は1操作で複数回（ローカル反映＋サーバー確定＋
// 繰り返しタスクの追加など）短時間に連続発火する。そのたびに画面全体を
// 作り直すと checkdraw アニメが途中で再起動して「ぶれる」ため、
// requestAnimationFrame で1フレームに集約して1回だけ描画する。
// また、ドラッグ並び替え/スワイプ削除のジェスチャー中に自分と無関係な
// Firestore更新（他デバイスでの編集、期限切れ自動繰り上げ等）が飛んでくると
// wireScreenEvents() 内での detachDragSort/attachSwipeToDelete の再アタッチが
// 進行中のジェスチャーを内部状態ごと吹き飛ばしてしまう（スマホでたまにタスクの
// ドラッグが反応しなくなる不具合の一因）。ジェスチャー中は再描画を保留し、
// 終了を待ってから反映する。
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    if (isDragActive() || isSwipeActive()) {
      requestRender(); // ジェスチャー終了まで次フレームに持ち越す
      return;
    }
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
        </div>
      </div>
      <div class="timeline-label-row">
        <div class="timeline-label">タイムライン</div>
        <div style="display:flex;align-items:center;gap:10px">
          ${calChip}
          <div class="timeline-done">${doneN} / ${dayTasks.length} 完了</div>
        </div>
      </div>
      <div class="task-list-scroll scroll">
        <div class="task-list-pad">${renderTodayTimeline(dayTasks, events, state.projects, state.doneCollapsed)}</div>
      </div>
    </div>`;
}

function renderWeekScreen() {
  // 「今週」は暦週（月〜日等）ではなく、常に「今日から7日間」のローリング表示にする。
  const weekStart = todayStr();
  const { html, total } = renderWeekView(state.tasks, weekStart, state.projects, state.weekCalEventsByDate);
  const weekEndDay = addDays(weekStart, 6);
  const rangeLabel = `${new Date(weekStart + "T00:00:00").getMonth() + 1}月 ${new Date(
    weekStart + "T00:00:00"
  ).getDate()}–${new Date(weekEndDay + "T00:00:00").getDate()}`;
  const monthCal = renderMonthCalendar(
    state.tasks,
    state.weekCalEventsByDate,
    state.projects,
    state.weekCalAnchor,
    state.weekDetailDate
  );
  // 月カレンダーで日付をタップしたら、タブを切り替えずに今週タブ内でその日のタイムラインを見せる
  let bodyHtml;
  if (state.weekDetailDate) {
    const d = state.weekDetailDate;
    const dayTasks = state.tasks.filter((t) => t.date === d);
    const doneN = dayTasks.filter((t) => t.done).length;
    const events = state.weekCalEventsByDate[d] || [];
    bodyHtml = `
      <div class="week-detail-header">
        <div class="week-detail-title">${formatHeaderDate(d)}</div>
        <div class="week-detail-close" id="week-detail-close-btn">✕</div>
      </div>
      <div class="timeline-label-row">
        <div class="timeline-label">タイムライン</div>
        <div class="timeline-done">${doneN} / ${dayTasks.length} 完了</div>
      </div>
      <div class="task-list-pad">${renderTodayTimeline(dayTasks, events, state.projects, state.doneCollapsed)}</div>`;
  } else {
    bodyHtml = `
      <div style="padding:0 16px">
        ${html || '<div class="empty-state">該当するタスクはありません</div>'}
      </div>`;
  }
  return `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:12px">
        <div class="eyebrow muted">THIS WEEK</div>
        <div style="display:flex;justify-content:space-between;align-items:flex-end">
          <div class="title-md">${rangeLabel}</div>
          <div style="font-size:11.5px;color:rgba(240,240,245,0.32)">${total}件</div>
        </div>
      </div>
      <div class="task-list-scroll scroll" style="padding:0 0 120px">
        ${monthCal}
        ${bodyHtml}
      </div>
    </div>`;
}

// 1プロジェクト分のカードHTMLを生成する（長期/短期どちらのグループでも共用）。
function renderProjectCard(p) {
  const subs = state.tasks
    .filter((t) => t.projectId === p.id)
    .sort((a, b) => taskSortKey(a) - taskSortKey(b));
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
      <div class="subtask-row" data-task-id="${t.id}" data-sort-key="${t.order ?? ""}">
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
    <div class="project-swipe-area">
      <div class="project-header-row" data-toggle-project="${p.id}">
        <div>
          <div class="project-name">${escapeHtml(p.title)}</div>
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
          <div data-edit-project="${p.id}" style="cursor:pointer">
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
            <div class="add-subtask-btn" data-add-subtask="${p.id}">＋ タスクを追加</div>
          </div>`
          : ""
      }
    </div>
  </div>`;
}

// 締切未設定を先頭に、それ以降は締切日の早い順に並べる比較関数。
function byDueDate(a, b) {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return -1;
  if (!b.dueDate) return 1;
  return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
}

function renderProjectsScreen() {
  // 締切日から長期/短期を自動判定し、タブで切り替えて表示する（締切まで15日以上先=長期）。
  // 各グループ内は締切日の早い順（未設定は最後）に並べる。
  const longTerm = state.projects.filter(isLongTermProject).sort(byDueDate);
  const shortTerm = state.projects.filter((p) => !isLongTermProject(p)).sort(byDueDate);
  const groups = { short: shortTerm, long: longTerm };
  const activeProjects = groups[state.projectTab] || shortTerm;
  const cards = activeProjects.map(renderProjectCard).join("");
  const tabHtml = (tab, label, count) => `
    <div class="project-tab-opt${state.projectTab === tab ? " project-tab-opt-active" : ""}" data-project-tab="${tab}">
      <span>${label}</span><span class="project-group-count">${count}</span>
    </div>`;
  return `
    <div class="screen">
      <div class="screen-header" style="padding-bottom:14px">
        <div class="eyebrow muted">PROJECTS</div>
        <div class="title-md">プロジェクト</div>
      </div>
      <div class="project-tab-toggle">
        ${tabHtml("short", "短期", shortTerm.length)}
        ${tabHtml("long", "長期", longTerm.length)}
      </div>
      <div class="task-list-scroll scroll" style="padding:0 16px 120px">
        ${cards || '<div class="empty-state">プロジェクトがありません</div>'}
      </div>
    </div>`;
}

function wireScreenEvents() {
  // today: calendar 連携トグル
  const calToggle = $("#cal-toggle");
  if (calToggle) calToggle.addEventListener("click", onCalendarToggle);
  // week: 日別詳細インライン表示を閉じる
  const weekDetailClose = $("#week-detail-close-btn");
  if (weekDetailClose)
    weekDetailClose.addEventListener("click", () => {
      state.weekDetailDate = null;
      renderScreen();
    });
  // today: 完了済みセクションの開閉
  const doneToggle = $("#done-section-toggle");
  if (doneToggle)
    doneToggle.addEventListener("click", () => {
      state.doneCollapsed = !state.doneCollapsed;
      renderScreen();
    });
  // projects: 短期/長期タブ切り替え
  $$("[data-project-tab]").forEach((el) => {
    el.addEventListener("click", () => {
      state.projectTab = el.dataset.projectTab;
      renderScreen();
    });
  });
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
  // week: タップで編集（カレンダー予定行は data-task-id が無いので読み取り専用）
  $$(".week-task-row").forEach((el) => {
    const taskId = el.dataset.taskId;
    if (!taskId) return;
    el.addEventListener("click", () => openSheet({ taskId }));
  });
  // week: 月カレンダーのセル = 今週タブ内にその日の詳細（予定＋タスク）をインライン表示。
  // 同じ日をもう一度タップしたら閉じる。矢印 = 月移動
  $$(".mc-cell").forEach((el) => {
    el.addEventListener("click", () => {
      const d = el.dataset.date;
      state.weekDetailDate = state.weekDetailDate === d ? null : d;
      renderScreen();
    });
  });
  $$("[data-cal-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const dir = el.dataset.calNav === "prev" ? -1 : 1;
      const a = new Date(state.weekCalAnchor + "T00:00:00");
      state.weekCalAnchor = toDateStr(new Date(a.getFullYear(), a.getMonth() + dir, 1));
      renderScreen();
      refreshWeekCalendar();
    });
  });
  // projects: toggle open
  $$("[data-toggle-project]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.toggleProject;
      const p = state.projects.find((x) => x.id === id);
      p.open = !p.open;
      renderScreen();
      // Firestoreにも保存しないと、他のプロジェクトを編集した際の再購読で
      // open状態がリセットされてしまう（onSnapshotは毎回全件を返すため）。
      updateProject(id, { open: p.open }).catch((e) => console.error("開閉状態の保存に失敗:", e));
    });
  });
  // projects: 締切表示のタップでプロジェクト編集モーダルを開く（開閉トグルとは独立させる）
  $$("[data-edit-project]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = state.projects.find((x) => x.id === el.dataset.editProject);
      if (p) openProjectModal(p);
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
  // タブ切り替え時に前回のイベントをすべて解除
  detachAllSwipe();
  detachDragSort();
  if (state.view === "today" || (state.view === "week" && state.weekDetailDate)) {
    const pad = $(".task-list-pad");
    if (pad) {
      // 「今日中」「+α」セクションをまたいで移動したら priority も更新する。
      // 隣接する行（カレンダー予定は data-priority なし）の priority を優先的に継承。
      const computeExtraPriority = (prevRow, nextRow) => {
        const p = prevRow?.dataset.priority || nextRow?.dataset.priority || "today";
        return { priority: p };
      };
      attachDragSort(pad, (id) => state.tasks.find((t) => t.id === id), ".task-row[data-task-id]", computeExtraPriority);
      // 左スワイプでタスクを削除
      attachSwipeToDelete(pad, {
        rowSelector: ".task-row[data-task-id]",
        foregroundSelector: ".task-card",
        getId: (row) => row.dataset.taskId,
        onDelete: (id) => deleteTaskById(id),
      });
    }
  } else {
    if (state.view === "projects") {
      const scroll = $(".task-list-scroll");
      // 左スワイプでプロジェクト（＋所属タスク）を削除
      if (scroll)
        attachSwipeToDelete(scroll, {
          rowSelector: ".project-card",
          foregroundSelector: ".project-swipe-area",
          getId: (row) => row.dataset.projectId,
          onDelete: (id, row) => confirmDeleteProject(id, row),
        });
      // 展開中プロジェクトの subtask リストに並び替えを attach
      $$(".project-subtasks").forEach((container) => {
        attachDragSort(container, (id) => state.tasks.find((t) => t.id === id), ".subtask-row[data-task-id]");
      });
    }
  }
}

async function deleteTaskById(id) {
  try {
    await deleteTask(id);
    flash("タスクを削除しました");
  } catch (e) {
    console.error("タスク削除に失敗:", e);
    flash("削除に失敗しました");
  }
}

function confirmDeleteProject(id, row) {
  // スワイプを閉じるため一旦元に戻す
  const fg = row?.querySelector(".project-swipe-area");
  if (fg) { fg.style.transition = ""; fg.style.transform = ""; }

  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const p = state.projects.find((x) => x.id === id);
  const childCount = state.tasks.filter((t) => t.projectId === id).length;
  overlay.innerHTML = `
    <div class="confirm-sheet">
      <div class="confirm-title">「${escapeHtml(p?.title ?? "")}」を削除しますか？</div>
      <div class="confirm-body">このプロジェクトと所属タスク ${childCount} 件がすべて削除されます。この操作は取り消せません。</div>
      <button class="confirm-btn-delete">削除する</button>
      <button class="confirm-btn-cancel">キャンセル</button>
    </div>`;
  overlay.querySelector(".confirm-btn-delete").addEventListener("click", async () => {
    overlay.remove();
    await deleteProjectById(id);
  });
  overlay.querySelector(".confirm-btn-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("app-root").appendChild(overlay);
}

async function deleteProjectById(id) {
  try {
    // 所属タスクをまとめて削除してからプロジェクト本体を削除
    const childIds = state.tasks.filter((t) => t.projectId === id).map((t) => t.id);
    await Promise.all(childIds.map((tid) => deleteTask(tid)));
    await deleteProject(id);
    flash("プロジェクトを削除しました");
  } catch (e) {
    console.error("プロジェクト削除に失敗:", e);
    flash("削除に失敗しました");
  }
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

// 今週タブの月カレンダー：表示中の月（グリッドに出る前後の週も含む）の予定を取得。
// 同じ月を取得済みならスキップ。
let weekCalLoading = false;
async function refreshWeekCalendar() {
  if (!state.calendarConnected) return;
  const a = new Date(state.weekCalAnchor + "T00:00:00");
  const monthKey = `${a.getFullYear()}-${a.getMonth() + 1}`;
  if (weekCalLoading || state.weekCalLoadedMonth === monthKey) return;
  // グリッドは当月1日のある週の日曜〜6週後まで。前後の余白も含めて取得する。
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const gridStart = new Date(a.getFullYear(), a.getMonth(), 1 - first.getDay());
  const gridEnd = new Date(gridStart);
  gridEnd.setDate(gridStart.getDate() + 41);
  weekCalLoading = true;
  try {
    state.weekCalEventsByDate = await fetchEventsRange(toDateStr(gridStart), toDateStr(gridEnd));
    state.weekCalLoadedMonth = monthKey;
    if (state.view === "week") renderScreen();
  } catch (e) {
    console.error("月カレンダー取得エラー", e);
  } finally {
    weekCalLoading = false;
  }
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

// プロジェクトの追加・編集フォーム。window.prompt() はデスクトップ版（Electron）で
// ネイティブ実装が無く即座にnullを返すため使えない（ボタンが反応しないように見える
// 不具合の原因だった）。アプリ内モーダルで全プラットフォームで動くようにする。
// existingProject を渡すと編集モード（タイトル・締切日をプリフィルし、保存でupdateProject）。
function openProjectModal(existingProject = null) {
  const isEdit = !!existingProject;
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-sheet">
      <div class="confirm-title">${isEdit ? "プロジェクトを編集" : "プロジェクトを追加"}</div>
      <input id="new-project-title" class="field-input add-project-input" placeholder="プロジェクト名を入力" autocomplete="off" value="${isEdit ? escapeHtml(existingProject.title) : ""}" />
      <div class="field-box-label" style="margin:14px 0 6px">締切日（任意）</div>
      <input type="date" id="new-project-due" class="date-input-native add-project-input" value="${isEdit ? existingProject.dueDate || "" : ""}" />
      <button class="confirm-btn-delete confirm-btn-primary" id="new-project-save" ${isEdit ? "" : "disabled"}>${isEdit ? "保存する" : "追加する"}</button>
      <button class="confirm-btn-cancel">キャンセル</button>
    </div>`;
  const titleInput = overlay.querySelector("#new-project-title");
  const dueInput = overlay.querySelector("#new-project-due");
  const saveBtn = overlay.querySelector("#new-project-save");
  const cancelBtn = overlay.querySelector(".confirm-btn-cancel");
  const updateSaveEnabled = () => {
    saveBtn.disabled = !titleInput.value.trim();
  };
  titleInput.addEventListener("input", updateSaveEnabled);
  const save = async () => {
    const title = titleInput.value.trim();
    if (!title) return;
    overlay.remove();
    if (isEdit) {
      await updateProject(existingProject.id, { title, dueDate: dueInput.value || null });
      flash("プロジェクトを更新しました");
    } else {
      const color = PROJECT_COLORS[state.projects.length % PROJECT_COLORS.length];
      await addProject({ title, color, dueDate: dueInput.value || null, open: true });
      flash("プロジェクトを追加しました");
    }
  };
  saveBtn.addEventListener("click", save);
  titleInput.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    save();
  });
  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("app-root").appendChild(overlay);
  titleInput.focus();
}

// ---------- AIタスク一括追加 ----------
// AIチャット等で生成させたJSON配列（「タスクコード」）を貼り付けると複数タスクをまとめて
// 作成できる機能。フォーマットは [{ title, date?, project?, priority? }, ...] か、
// 単純な文字列配列（各要素をtitleのみのタスクにする）のどちらかを許容する。
const BULK_ADD_EXAMPLE = `[
  { "title": "タスク名", "date": "2026-07-10", "project": "プロジェクト名", "priority": "today" },
  { "title": "日付未定のタスク" }
]`;

// テキストをパースしてタスク配列を返す。不正な形式なら null、
// 個々の要素がtitleを欠く場合はその要素だけスキップする。
function parseBulkTasks(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  const tasks = [];
  for (const item of data) {
    if (typeof item === "string") {
      const title = item.trim();
      if (title) tasks.push({ title });
      continue;
    }
    if (item && typeof item === "object" && typeof item.title === "string" && item.title.trim()) {
      tasks.push({
        title: item.title.trim(),
        date: typeof item.date === "string" && item.date ? item.date : null,
        project: typeof item.project === "string" ? item.project.trim() : "",
        priority: item.priority === "extra" ? "extra" : "today",
      });
    }
  }
  return tasks;
}

function openBulkAddModal() {
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  overlay.innerHTML = `
    <div class="confirm-sheet">
      <div class="confirm-title">AIタスク一括追加</div>
      <div class="confirm-body">AIに生成させたJSON形式の「タスクコード」を貼り付けると、まとめてタスクを作成します。例:</div>
      <pre class="bulk-add-example">${escapeHtml(BULK_ADD_EXAMPLE)}</pre>
      <textarea id="bulk-add-input" class="field-input add-project-input bulk-add-textarea" placeholder="ここにJSONを貼り付け"></textarea>
      <button class="confirm-btn-delete confirm-btn-primary" id="bulk-add-save">追加する</button>
      <button class="confirm-btn-cancel">キャンセル</button>
    </div>`;
  const textInput = overlay.querySelector("#bulk-add-input");
  const saveBtn = overlay.querySelector("#bulk-add-save");
  const cancelBtn = overlay.querySelector(".confirm-btn-cancel");
  saveBtn.addEventListener("click", async () => {
    const tasks = parseBulkTasks(textInput.value.trim());
    if (!tasks) {
      flash("JSON形式で入力してください");
      return;
    }
    if (tasks.length === 0) {
      flash("追加できるタスクがありませんでした");
      return;
    }
    overlay.remove();
    const now = Date.now();
    await Promise.all(
      tasks.map((t, i) => {
        const project = t.project
          ? state.projects.find((p) => p.title.toLowerCase() === t.project.toLowerCase())
          : null;
        return addTask({
          title: t.title,
          date: t.date || null,
          projectId: project?.id || null,
          priority: t.priority === "extra" ? "extra" : "today",
          order: now + i,
        });
      })
    );
    flash(`${tasks.length}件のタスクを追加しました`);
  });
  cancelBtn.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("app-root").appendChild(overlay);
  textInput.focus();
}

// ---------- bottom sheet (add/edit task) ----------
const REPEAT_OPTIONS = [
  { type: "none", label: "なし" },
  { type: "weekly", label: "毎週金曜日", days: [5] },
  { type: "interval", label: "3日ごと", interval: 3 },
  { type: "interval", label: "毎日", interval: 1 },
];
// REPEAT_OPTIONS は type が重複する（interval違いの「3日ごと」「毎日」）ため、
// type だけでなく interval/days まで一致させて該当インデックスを特定する。
function findRepeatOptionIndex(repeat) {
  const type = repeat?.type || "none";
  return REPEAT_OPTIONS.findIndex((r) => {
    if (r.type !== type) return false;
    if (type === "interval") return (r.interval || 0) === (repeat?.interval || 0);
    if (type === "weekly") return JSON.stringify(r.days || []) === JSON.stringify(repeat?.days || []);
    return true;
  });
}

$("#open-sheet-btn").addEventListener("click", () => openSheet());
$("#add-project-fab").addEventListener("click", () => openProjectModal());
$("#bulk-add-btn").addEventListener("click", () => openBulkAddModal());

function defaultDraft() {
  return {
    title: "",
    date: state.selectedDate,
    repeatIndex: 0,
    projectIndex: 0,
    priority: "today",
  };
}

// 引数: { taskId } で編集モード、{ projectId } で新規（プロジェクトをプリセット）。
// 引数なし or 空オブジェクトで通常の新規追加。
function openSheet(opts = {}) {
  const { taskId, projectId, date } = opts;
  if (taskId) {
    const t = state.tasks.find((x) => x.id === taskId);
    if (!t) return;
    state.sheet = {
      open: true,
      editingId: taskId,
      draft: {
        title: t.title,
        date: t.date || state.selectedDate,
        repeatIndex: Math.max(0, findRepeatOptionIndex(t.repeat)),
        projectIndex: t.projectId ? state.projects.findIndex((p) => p.id === t.projectId) + 1 : 0,
        priority: t.priority === "extra" ? "extra" : "today",
      },
    };
  } else {
    const draft = defaultDraft();
    if (date) draft.date = date;
    if (projectId) {
      const idx = state.projects.findIndex((p) => p.id === projectId);
      if (idx >= 0) draft.projectIndex = idx + 1;
    }
    state.sheet = { open: true, editingId: null, draft };
  }
  renderSheet(true);
  // ⑤ iOSではユーザータップの直接の同期実行内でfocus()を呼ばないとキーボードが
  // 開かないため、setTimeoutを挟まず同期でフォーカスする
  $("#draft-title-input")?.focus();
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
  const projNames = ["なし", ...state.projects.map((p) => p.title)];
  const projColors = ["rgba(255,255,255,0.25)", ...state.projects.map((p) => p.color)];
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
            <div class="field-box" id="draft-project-box">
              <div class="field-box-label">プロジェクト</div>
              <div class="field-proj-row">
                <div class="proj-dot" style="background:${projColors[d.projectIndex]}"></div>
                <div style="font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(projNames[d.projectIndex])}</div>
              </div>
            </div>
          </div>
          <div class="field-tappable" id="draft-repeat-box">
            <div>
              <div class="field-box-label">繰り返し</div>
              <div class="field-box-val-sm">${REPEAT_OPTIONS[d.repeatIndex].label}</div>
            </div>
            <svg width="13" height="13" viewBox="0 0 12 12" fill="none"><path d="M2 6a4 4 0 014-4h2M10 6a4 4 0 01-4 4H4" stroke="rgba(149,128,255,0.6)" stroke-width="1.3" stroke-linecap="round"/><path d="M8 1l2 1.5-2 1.5M4 8L2 9.5 4 11" stroke="rgba(149,128,255,0.6)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="field-box-label" style="margin:14px 0 6px">優先度</div>
          <div class="priority-toggle">
            <div class="priority-opt${d.priority !== "extra" ? " priority-opt-active" : ""}" data-priority="today">今日中</div>
            <div class="priority-opt${d.priority === "extra" ? " priority-opt-active" : ""}" data-priority="extra">+α</div>
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
  $("#draft-repeat-box").addEventListener("click", () => {
    state.sheet.draft.repeatIndex = (state.sheet.draft.repeatIndex + 1) % REPEAT_OPTIONS.length;
    renderSheet();
  });
  $("#draft-project-box").addEventListener("click", openProjectPicker);
  $$(".priority-opt").forEach((el) => {
    el.addEventListener("click", () => {
      state.sheet.draft.priority = el.dataset.priority;
      renderSheet();
    });
  });
  $("#sheet-save-btn").addEventListener("click", saveDraftTask);
}

// タスク編集シート内「プロジェクト」欄のピッカー。日付ピッカーと同様、
// 一覧から1つ選ぶ体験にするため、タップ巡回方式をやめて選択肢を並べる。
function openProjectPicker() {
  const projNames = ["なし", ...state.projects.map((p) => p.title)];
  const projColors = ["rgba(255,255,255,0.25)", ...state.projects.map((p) => p.color)];
  const overlay = document.createElement("div");
  overlay.className = "confirm-overlay";
  const rows = projNames
    .map(
      (name, i) => `
      <div class="picker-row${i === state.sheet.draft.projectIndex ? " picker-row-active" : ""}" data-picker-idx="${i}">
        <div class="proj-dot" style="background:${projColors[i]}"></div>
        <div class="picker-row-label">${escapeHtml(name)}</div>
      </div>`
    )
    .join("");
  overlay.innerHTML = `
    <div class="confirm-sheet">
      <div class="confirm-title">プロジェクトを選択</div>
      <div class="picker-list">${rows}</div>
    </div>`;
  overlay.querySelectorAll("[data-picker-idx]").forEach((el) => {
    el.addEventListener("click", () => {
      state.sheet.draft.projectIndex = Number(el.dataset.pickerIdx);
      overlay.remove();
      renderSheet();
    });
  });
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  document.getElementById("app-root").appendChild(overlay);
}

// draftをFirestoreに書き込む。成功すればtrueを返す。
async function commitDraft() {
  const d = state.sheet.draft;
  if (!d.title || !d.title.trim()) {
    flash("タイトルを入力してください");
    return false;
  }
  const repeatOpt = REPEAT_OPTIONS[d.repeatIndex];
  const projIdx = d.projectIndex;
  const projectId = projIdx > 0 ? state.projects[projIdx - 1].id : null;
  const payload = {
    title: d.title.trim(),
    date: d.date || null,
    projectId,
    priority: d.priority === "extra" ? "extra" : "today",
    repeat: {
      type: repeatOpt.type,
      days: repeatOpt.days || [],
      interval: repeatOpt.interval || 0,
    },
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
// 他のフィールド（日付・プロジェクト・繰り返し）は維持する。
async function saveDraftAndContinue() {
  if (state.sheet.editingId) {
    // 編集モード中はEnterで通常保存（次へではなく確定）
    if (await commitDraft()) closeSheet();
    return;
  }
  if (!(await commitDraft())) return;
  state.sheet.draft = { ...state.sheet.draft, title: "" };
  renderSheet(); // animate-in なしで再描画
  $("#draft-title-input")?.focus();
}

// ---------- 日付またぎの追従 ----------
// 今日タブは常に state.selectedDate が「今日」を指す前提で動いている。
// PWAを日をまたいで開きっぱなしにすると selectedDate が前日のまま固まり、
// carryOverOverdueTasks が date を新しい今日に書き換えても表示フィルタ
// (selectedDate)とズレて消えて見える問題があったため、日付変化を検知したら
// selectedDate を更新し、引き継ぎ判定もやり直す。
let lastKnownToday = todayStr();
function syncSelectedDateToToday() {
  const today = todayStr();
  if (lastKnownToday === today) return;
  lastKnownToday = today;
  carryOverOverdueTasks();
  state.selectedDate = today;
  if (state.view === "today") renderScreen();
}
setInterval(syncSelectedDateToToday, 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) syncSelectedDateToToday();
});

// ---------- init ----------
updateTabBar();
