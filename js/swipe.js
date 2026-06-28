// 左スワイプで「削除」ボタンを表示し、タップで確定する iOS 風の操作。
// - 横方向に優勢なスワイプのみ反応（縦はスクロール/並び替えに譲る）
// - 一定量左にスワイプして指を離すと開いた状態を保持、削除ボタンのタップで onDelete
// - 別の場所をタップ／別カードをスワイプすると閉じる
// 今日タブのタスク行（縦ドラッグ並び替えと併用）とプロジェクトカードに適用。

const OPEN_W = 80; // 削除ボタンの表示幅(px)
const DECIDE_PX = 6; // 方向を判定する移動量
const COMMIT_PX = 38; // これ以上スワイプして離すと開いたままにする

let detachers = [];

// container: 行が並ぶスクロール要素
// opts: { rowSelector, getId(row), onDelete(id,row), foregroundSelector? }
//   foregroundSelector を渡すとその要素を前景としてスライド。
//   省略時は行の子要素を .swipe-fg でまとめて前景にする。
export function attachSwipeToDelete(container, opts) {
  if (!container) return;
  const { rowSelector, getId, onDelete, foregroundSelector } = opts;

  let openRow = null; // 現在開いているカード
  let g = null; // 進行中ジェスチャ { row, fg, btn, startX, startY, baseX, dir }
  let clickSuppressed = false;

  function ensureRow(row) {
    if (row.dataset.swipeReady) return;
    row.dataset.swipeReady = "1";
    row.style.position = "relative";
    row.style.overflow = "hidden";

    let fg;
    if (foregroundSelector) {
      fg = row.querySelector(foregroundSelector);
    } else {
      fg = document.createElement("div");
      fg.className = "swipe-fg";
      while (row.firstChild) fg.appendChild(row.firstChild);
      row.appendChild(fg);
    }
    fg.classList.add("swipe-fg");

    const btn = document.createElement("button");
    btn.className = "swipe-delete";
    btn.type = "button";
    btn.textContent = "削除";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      e.preventDefault();
      onDelete(getId(row), row);
    });
    // pointerdown が行のスワイプ判定に巻き込まれないよう前面で受ける
    btn.addEventListener("pointerdown", (e) => e.stopPropagation());
    row.insertBefore(btn, fg);

    row._swipe = { fg, btn };
  }

  function setX(row, x, animate) {
    const { fg, btn } = row._swipe;
    fg.style.transition = animate ? "" : "none";
    fg.style.transform = x ? `translateX(${x}px)` : "";
    btn.style.opacity = String(Math.min(1, -x / OPEN_W));
  }

  function closeRow(row, animate = true) {
    if (!row || !row._swipe) return;
    setX(row, 0, animate);
    if (openRow === row) openRow = null;
  }

  function onPointerDown(e) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const row = e.target.closest(rowSelector);
    if (!row || !container.contains(row)) {
      if (openRow) closeRow(openRow);
      return;
    }
    ensureRow(row);
    // 別のカードが開いていたら閉じる
    if (openRow && openRow !== row) closeRow(openRow);
    g = {
      row,
      startX: e.clientX,
      startY: e.clientY,
      wasOpen: openRow === row,
      baseX: openRow === row ? -OPEN_W : 0,
      dir: null,
    };
  }

  function onPointerMove(e) {
    if (!g) return;
    const dx = e.clientX - g.startX;
    const dy = e.clientY - g.startY;
    if (g.dir === null) {
      if (Math.hypot(dx, dy) < DECIDE_PX) return;
      // 横優勢のときだけスワイプ。縦優勢なら以降無視（スクロール/並び替え優先）
      g.dir = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      if (g.dir === "v") {
        g = null;
        return;
      }
    }
    if (g.dir !== "h") return;
    e.preventDefault();
    const x = Math.max(-OPEN_W, Math.min(0, g.baseX + dx));
    setX(g.row, x, false);
  }

  function onPointerUp() {
    if (!g) return;
    const cur = g;
    g = null;
    if (cur.dir !== "h") {
      // 開いているカード本体をタップしたら閉じる（編集は開かない）
      if (cur.wasOpen) {
        closeRow(cur.row);
        clickSuppressed = true;
        setTimeout(() => (clickSuppressed = false), 300);
      }
      return;
    }
    const x = currentX(cur.row);
    if (x <= -COMMIT_PX) {
      setX(cur.row, -OPEN_W, true);
      openRow = cur.row;
    } else {
      closeRow(cur.row);
    }
    // スワイプ直後の click（編集オープン）を1回だけ無視
    clickSuppressed = true;
    setTimeout(() => (clickSuppressed = false), 300);
  }

  function currentX(row) {
    const m = /translateX\((-?\d+(?:\.\d+)?)px\)/.exec(row._swipe.fg.style.transform);
    return m ? parseFloat(m[1]) : 0;
  }

  function onClickCapture(e) {
    if (clickSuppressed) {
      e.stopPropagation();
      e.preventDefault();
      clickSuppressed = false;
    }
  }

  container.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);
  container.addEventListener("click", onClickCapture, true);

  detachers.push(() => {
    container.removeEventListener("pointerdown", onPointerDown);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
    document.removeEventListener("pointercancel", onPointerUp);
    container.removeEventListener("click", onClickCapture, true);
  });
}

export function detachAllSwipe() {
  detachers.forEach((fn) => fn());
  detachers = [];
}
