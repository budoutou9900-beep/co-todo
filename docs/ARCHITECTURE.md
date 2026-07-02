# アーキテクチャ

## 全体像

ビルドツール・フレームワークを使わない素のHTML/CSS/JS（ESモジュール）構成。単一ページアプリで、
`index.html` に画面シェル（ログイン画面／アプリ本体／タブバーの器）が入っており、
JSが `innerHTML` を書き換えることで画面遷移する。

```
index.html ── 画面シェル、各種コンテナ（#screen-content, #sheet-container 等）
  └─ js/app.js ── 状態管理・画面描画・イベント配線の中心。他の全モジュールをここでまとめる
       ├─ js/firebase-config.js ── Firebase初期化（App/Firestore/Auth）
       ├─ js/auth.js            ── Googleログイン/ログアウト・認証状態監視
       ├─ js/db.js              ── Firestore CRUD・onSnapshotによるリアルタイム購読
       ├─ js/tasks.js           ── 繰り返しタスクの次回分生成ロジック
       ├─ js/calendar.js        ── 月カレンダー・週ビューのHTML生成（純関数寄り）
       ├─ js/calendar-sync.js   ── Google Calendar API（読み取り専用）との連携
       ├─ js/timeline.js        ── 今日タブのタイムラインHTML生成（純関数寄り）
       ├─ js/drag.js            ── 長押し/ドラッグによる並び替えの汎用実装
       ├─ js/swipe.js           ── 左スワイプ削除の汎用実装
       └─ js/utils.js           ── 日付整形・色変換などの共通ユーティリティ
```

## 状態管理パターン

`js/app.js` 冒頭の `state` オブジェクトが唯一のソース・オブ・トゥルース。React/Vueのような
仮想DOM diffingは無く、「状態を書き換える → `renderScreen()` を呼ぶ → 対象コンテナの
`innerHTML` を丸ごと再生成する」という素朴な即時再描画パターンを採用している。

```js
function renderScreen() {
  const content = $("#screen-content");
  let html = ...; // state.view に応じてrenderTodayScreen/renderWeekScreen/renderProjectsScreenのどれか
  if (html === lastRenderedHtml) return; // 同一内容なら再描画スキップ
  content.innerHTML = html;
  wireScreenEvents(); // innerHTML書き換え後、イベントリスナーを再アタッチ
}
```

**なぜdiffingしていないか**: 規模が小さく、Firestoreの`onSnapshot`によるリアルタイム更新頻度も
低いため、フルHTML再生成のシンプルさを優先している。ただし「同一HTML文字列なら再描画しない」
というメモ化だけは入れており、Firestoreが同一データで複数回通知してきても、進行中のCSS
アニメーション（完了チェックのアニメなど）が壊れないようにしている。

## データフロー（Firestore連携）

1. ログイン成功後、`startSubscriptions()` が `subscribeToTasks` / `subscribeToProjects` を呼び、
   `onSnapshot` によるリアルタイム購読を開始する。
2. Firestoreから変更通知が来るたびに `state.tasks` / `state.projects` を丸ごと差し替え、
   `requestRender()`（`requestAnimationFrame`で1フレームにまとめる版の再描画）を呼ぶ。
3. 書き込み（`addTask` / `updateTask` / `deleteTask` 等）はローカルの`state`を直接は書き換えず、
   Firestoreへの書き込み → `onSnapshot`が発火 → `state`が更新される、という一方向の流れ。
   楽観的UI更新は行っていない。

この設計により「別デバイスで編集した内容が自動的に反映される」というマルチデバイス同期が、
特別な同期ロジックを書かずに実現されている。

**ジェスチャー中の再描画抑制**: `requestRender()` は、`drag.js`/`swipe.js`が公開する
`isDragActive()` / `isSwipeActive()` を確認し、ドラッグ並び替えやスワイプ削除のジェスチャーが
進行中なら描画を保留して次フレームに再チェックする。これが無いと、自分と無関係なFirestore更新
（他デバイスでの編集や期限切れタスクの自動繰り上げ等）が飛んできた際に `wireScreenEvents()` が
`detachDragSort()`/`attachSwipeToDelete()` を再アタッチし、進行中のジェスチャーの内部状態
（`state.waiting`/`state.dragging`等）が失われてしまう（スマホで指を置いたままドラッグしているのに
反応しなくなる不具合の原因だった）。ユーザー操作起点の`renderScreen()`直接呼び出し
（タスク追加・削除・タブ切り替え等）はこのガードの対象外で、従来通り即時反映される。

## 汎用UIインタラクションモジュール

### `js/drag.js`（並び替え）

`attachDragSort(listContainer, getTaskById, rowSelector, computeExtra)` という汎用APIで、
今日タブのタスクリストとプロジェクト内のサブタスクリストの両方に使い回している。

- タッチ: 400ms長押しで開始。長押し待ち中に横優勢の動きが一定量あればキャンセルして
  `swipe.js`のスワイプ削除に譲るが、縦優勢・斜め方向の揺れではキャンセルしない
  （指の自然な手ぶれで縦ドラッグが始まらなくなる不具合の対策）。
  マウス: 縦方向の移動があれば即開始（横移動はスワイプ削除に譲る）。
- ドラッグ確定時、隣接する2行の `order` の中間値を新しい `order` として計算し、Firestoreへ
  `updateTask(id, { order: newOrder, ...extraChanges })` する。
- `computeExtra(prevRow, nextRow)` はオプションのコールバックで、`order`以外に更新したい
  フィールドを返せる。今日タブでは「今日中」⇔「+α」セクションをまたいだ移動時に、
  隣接行の `data-priority` 属性から `priority` フィールドを継承させるために使っている。
- +αセクションが空のときもドロップ先として機能させるため、`data-task-id`を持たない
  透明な「ドロップ受け皿」行（`.task-row.extra-drop-zone`）を配置し、境界判定に含めている
  （`timeline.js`参照）。
- プロジェクトタブでも展開中のサブタスクリストに適用される。並び順の描画は
  `state.tasks`をプロジェクトIDでフィルタしただけでは`order`順にならない
  （Firestoreのクエリ自体は`createdAt desc`のため）ので、描画前に`taskSortKey`
  （[js/timeline.js](../js/timeline.js)、`order`優先・無ければ`createdAt`）でソートしてから
  表示する必要がある（怠ると並び替え直後に表示が巻き戻る）。
- `isDragActive()` をエクスポートしており、進行中のジェスチャー数（長押し待ち含む）が
  0より大きい間はtrueを返す。`app.js`の`requestRender()`から参照される。

### `js/swipe.js`（左スワイプ削除）

`attachSwipeToDelete(container, { rowSelector, getId, onDelete, foregroundSelector })` という
汎用APIで、今日タブのタスク行とプロジェクトカードの両方に使い回している。

- 横方向優勢のジェスチャーのみ反応し、縦スワイプ（スクロールや`drag.js`の並び替え）とは
  競合しないよう方向判定している。
- `onDelete`コールバックの中身は呼び出し側の裁量。プロジェクト削除では、直接削除せず
  確認モーダル（`confirmDeleteProject`、[js/app.js](../js/app.js)）を挟むようにしている。
- `isSwipeActive()` をエクスポートしており、`drag.js`の`isDragActive()`と同じ考え方で
  ジェスチャー進行中を`app.js`の`requestRender()`に伝える。

## 認証フローの分岐（`js/auth.js`）

| 環境 | 方式 | 理由 |
|---|---|---|
| モバイルSafari / PWA (standalone) | `signInWithRedirect` | `signInWithPopup`はGoogleの"disallowed_useragent"判定でブロックされるため |
| デスクトップ版（Electron） | システムブラウザでOAuth → `signInWithCredential` | 埋め込みブラウザのOAuthをGoogleが弾くため。`window.desktopAuth.googleOAuth()`経由でトークンを受け取る |
| 通常のデスクトップブラウザ | `signInWithRedirect` | 上記いずれにも該当しない場合のデフォルト |

## Googleカレンダー連携の認可フロー（`js/calendar-sync.js`）

Firebase Authとは完全に別の認可フロー。Google Identity Services (GIS) の
`initTokenClient` でOAuthトークンクライアントを作り、`calendar.readonly` スコープの
アクセストークンをブラウザ上で直接取得・保持する（サーバーを経由しない）。

- トークンの有効期限は約1時間。`getToken()`が期限切れを検知したら`interactive: false`で
  サイレント再取得を試みる。401が返ってきた場合も1回だけサイレント再取得してリトライする。
- 連携状態（`isConnected()`）は `localStorage` の1フラグのみで管理し、実際のアクセストークンは
  メモリ上（モジュールスコープの変数）にしか保持しない。リロード後はサイレント取得で復元する。

## デプロイ・配信

- **Firebase Hosting**を使用（GitHub Pagesは`authDomain`が別ドメインになりiOSのITPで
  ログインループが発生するため不採用。詳細は[README.md](../README.md)）。
- **Service Worker**（[sw.js](../sw.js)）: `index.html`はnavigateリクエスト時にネットワーク優先
  ＋オフライン時のみキャッシュフォールバック。JS/CSSもネットワーク優先（開発中の変更を
  即時反映するため）でキャッシュはあくまでフォールバック用途。
- **デスクトップ版**（[desktop/](../desktop/)）はElectronラッパーで本番URLをそのまま読み込む
  別配布物。Webアプリ本体のコード変更は`firebase deploy`一発で両方に反映される。
