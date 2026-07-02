// 今日タスクリストの長押しドラッグ並び替え。プロジェクト内タスクにも汎用利用される。
// - 対象: data-task-id を持つ .task-row のみ（カレンダー予定は無視）
// - 開始判定: 400ms 長押し中に横優勢の動きが 6px 以上あったらキャンセル（swipe.jsに譲る）。
//   縦優勢・斜め方向の揺れはキャンセルしない（指の自然な手ぶれでドラッグが始まらなくなる不具合の対策）
// - 並び替え中は他の要素のクリック（タップ編集・完了切替）を抑制
// - 確定時: 隣接2要素の order の中間値を採用、現在の要素の order を更新
// - isDragActive(): ジェスチャー進行中はFirestore更新起点の再描画を止めたいapp.js側から参照する

import { updateTask } from "./db.js";

const LONG_PRESS_MS = 400;
const MOVE_TOLERANCE = 6;

let activeAttaches = [];
// 現在進行中（長押し待ち含む）のジェスチャー数。0より大きい間はレンダリングを止めたい
// （app.jsのrequestRenderが参照する）。
let activeGestureCount = 0;
export function isDragActive() {
  return activeGestureCount > 0;
}

// listContainer: .task-list-pad（子に .task-row が並ぶ）
// getTaskById: state.tasks から id でタスクを引く関数（order値の参照用）
// rowSelector: ドラッグ対象の CSS セレクタ（省略時は ".task-row[data-task-id]"）
// computeExtra(prevRow, nextRow): order 以外に追加保存したいフィールドを返す任意の関数
//   （例: 今日タブで「今日中」「+α」セクションをまたいだ移動時に priority を更新）
export function attachDragSort(listContainer, getTaskById, rowSelector = ".task-row[data-task-id]", computeExtra = null) {
  if (!listContainer) return;

  const state = {
    waiting: null, // { taskId, el, startX, startY, timer }
    dragging: null, // { taskId, el, rows, height, offsetY, scrollEl, currentIndex }
  };

  function pickRow(target) {
    const el = target.closest(rowSelector);
    return el && listContainer.contains(el) ? el : null;
  }

  function cancelWait() {
    if (!state.waiting) return;
    clearTimeout(state.waiting.timer);
    state.waiting = null;
    activeGestureCount = Math.max(0, activeGestureCount - 1);
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const row = pickRow(e.target);
    if (!row) return;
    const isMouse = e.pointerType === "mouse";
    state.waiting = {
      taskId: row.dataset.taskId,
      el: row,
      startX: e.clientX,
      startY: e.clientY,
      isMouse,
      // マウスは長押し不要（少し動かしたら即ドラッグ）。タッチ/ペンは長押しで開始。
      timer: isMouse ? null : setTimeout(() => beginDrag(e), LONG_PRESS_MS),
    };
    activeGestureCount++;
  }

  function beginDrag(originEvent) {
    if (!state.waiting) return;
    const { el, taskId } = state.waiting;
    state.waiting = null;
    // ドラッグできるのは data-task-id を持つタスク行のみだが、配置先の境界には
    // カレンダー予定行(.task-row)も含める＝予定と予定の間に挿入できる。
    const rows = Array.from(listContainer.querySelectorAll(rowSelector.split("[")[0]));
    const currentIndex = rows.indexOf(el);
    if (currentIndex < 0) return;
    const rect = el.getBoundingClientRect();
    const height = rect.height;
    const offsetY = originEvent.clientY - rect.top;
    el.classList.add("dragging");
    // フロート化（width固定で左端揃え保持）
    el.style.position = "fixed";
    el.style.left = rect.left + "px";
    el.style.width = rect.width + "px";
    el.style.top = rect.top + "px";
    el.style.zIndex = "100";
    el.style.pointerEvents = "none";
    el.style.boxShadow = "0 8px 28px rgba(0,0,0,0.6)";
    // 他の行に同高さのスペースが残るよう、移動した行の場所に
    // 仮プレースホルダーを挿入（同じ高さの透明div）
    const placeholder = document.createElement("div");
    placeholder.className = "drag-placeholder";
    placeholder.style.height = height + "px";
    placeholder.style.marginBottom = getComputedStyle(el).marginBottom;
    el.after(placeholder);
    if (navigator.vibrate) navigator.vibrate(20);

    state.dragging = {
      taskId,
      el,
      placeholder,
      rows: rows.filter((r) => r !== el),
      height,
      offsetY,
      currentIndex,
      // 最終的に確定する rows 順（id配列）。currentIndex は移動先の位置。
    };
    document.body.classList.add("dragging-task");
  }

  function onPointerMove(e) {
    // ドラッグ未開始時の判定
    if (state.waiting) {
      const dx = e.clientX - state.waiting.startX;
      const dy = e.clientY - state.waiting.startY;
      if (state.waiting.isMouse) {
        // マウス: 縦方向が優勢に動いたら即ドラッグ開始。
        // 横優勢の動き（左スワイプ削除など）はドラッグ扱いにしない。
        if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
          if (Math.abs(dy) >= Math.abs(dx)) beginDrag(e);
          else cancelWait();
        }
      } else if (Math.hypot(dx, dy) > MOVE_TOLERANCE) {
        // タッチ/ペン: 横優勢の動きのみキャンセル（スワイプ削除に譲る）。
        // 縦優勢や斜め方向は指の自然な揺れの範囲として長押しタイマーを継続させる
        // （横優勢判定のみでキャンセルすると、縦ドラッグ意図でも僅かな横ぶれで
        // タイマーが止まり「たまにドラッグが始まらない」不具合の原因になっていた）。
        if (Math.abs(dy) >= Math.abs(dx)) return;
        cancelWait();
      }
      return;
    }
    if (!state.dragging) return;
    e.preventDefault();
    const d = state.dragging;
    const top = e.clientY - d.offsetY;
    d.el.style.top = top + "px";

    // 指のY位置に応じてプレースホルダーを動かす
    const ph = d.placeholder;
    const center = e.clientY;
    // 他の行の中心と比較して、ph の位置を決める
    let inserted = false;
    for (const r of d.rows) {
      const rect = r.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (center < mid) {
        if (ph.nextSibling !== r) r.before(ph);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      const last = d.rows[d.rows.length - 1];
      if (last && ph.previousSibling !== last) last.after(ph);
    }
  }

  async function onPointerUp() {
    cancelWait();
    if (!state.dragging) return;
    const d = state.dragging;
    document.body.classList.remove("dragging-task");
    d.el.classList.remove("dragging");
    // 並び確定：プレースホルダーがある位置に el を戻し、新しい順序を計算
    d.placeholder.replaceWith(d.el);
    d.el.style.position = "";
    d.el.style.left = "";
    d.el.style.width = "";
    d.el.style.top = "";
    d.el.style.zIndex = "";
    d.el.style.pointerEvents = "";
    d.el.style.boxShadow = "";

    // 並び順を抽出（カレンダー予定行も境界として含める）
    const newOrderRows = Array.from(listContainer.querySelectorAll(rowSelector.split("[")[0]));
    const newIndex = newOrderRows.indexOf(d.el);
    if (newIndex < 0) {
      state.dragging = null;
      activeGestureCount = Math.max(0, activeGestureCount - 1);
      return;
    }
    const prev = newOrderRows[newIndex - 1];
    const next = newOrderRows[newIndex + 1];
    const newOrder = computeBetween(
      prev ? getOrderValue(prev) : null,
      next ? getOrderValue(next) : null
    );
    const extraChanges = computeExtra ? computeExtra(prev, next) : {};
    state.dragging = null;
    activeGestureCount = Math.max(0, activeGestureCount - 1);
    // タップ抑制のため少し待ってからイベント有効化（次の onclick を無視）
    suppressNextClick();
    try {
      await updateTask(d.taskId, { order: newOrder, ...extraChanges });
    } catch (err) {
      console.error("並び替えの保存に失敗:", err);
    }
  }

  function onClickCapture(e) {
    // ドラッグ確定直後のクリックを無視
    if (clickSuppressed) {
      e.stopPropagation();
      e.preventDefault();
      clickSuppressed = false;
    }
  }

  let clickSuppressed = false;
  function suppressNextClick() {
    clickSuppressed = true;
    setTimeout(() => (clickSuppressed = false), 350);
  }

  listContainer.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  listContainer.addEventListener("click", onClickCapture, true);

  const detach = () => {
    listContainer.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    listContainer.removeEventListener("click", onClickCapture, true);
    cancelWait();
    if (state.dragging) {
      state.dragging.placeholder?.remove();
      state.dragging = null;
      document.body.classList.remove("dragging-task");
      activeGestureCount = Math.max(0, activeGestureCount - 1);
    }
  };
  activeAttaches.push(detach);
}

export function detachDragSort() {
  activeAttaches.forEach((fn) => fn());
  activeAttaches = [];
}

// 行の並び替えキーを data-sort-key 属性から読む（タスク・カレンダー予定共通）。
// 終日予定の -Infinity など有限でない値は境界として無効＝null扱い。
function getOrderValue(rowEl) {
  const v = parseFloat(rowEl.dataset.sortKey);
  return Number.isFinite(v) ? v : null;
}

// 前後の order の中間値を返す。両端の場合は適度に大/小の値。
function computeBetween(prev, next) {
  if (prev == null && next == null) return Date.now();
  if (prev == null) return next - 1000;
  if (next == null) return prev + 1000;
  return (prev + next) / 2;
}
