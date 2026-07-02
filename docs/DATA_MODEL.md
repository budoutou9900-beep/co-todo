# データモデル（Firestore）

すべてのデータはユーザーごとに `users/{uid}/` 配下に隔離される。Firestoreセキュリティルール
（[firestore.rules](../firestore.rules)）により、本人（`request.auth.uid == userId`）のみが
読み書き可能。

マイグレーション機構は無いスキーマレスな運用のため、新フィールドを追加する際は
「未設定時のデフォルト解釈」をコード側（読み取り時）で必ず定義すること。

## `users/{uid}/tasks/{taskId}`

| フィールド | 型 | 説明 |
|---|---|---|
| `title` | string | タスク名 |
| `date` | string \| null | `"YYYY-MM-DD"`形式。未設定はFirstモードの候補にのみ現れる |
| `done` | boolean | 完了フラグ |
| `order` | number | 並び替え用のソートキー。新規追加時は `Date.now()`。手動並び替え時は隣接2件の`order`の中間値に書き換える（挿入型ソート、[js/drag.js](../js/drag.js)参照） |
| `priority` | `"today"` \| `"extra"` | 今日タブでの表示セクション。未設定時は`"today"`扱い |
| `projectId` | string \| null | 紐づく `projects/{projectId}` のID |
| `repeat` | object | `{ type: "none"\|"weekly"\|"interval", days: number[], interval: number }`。完了時に次回分を自動生成する条件判定に使う（[js/tasks.js](../js/tasks.js)） |
| `createdAt` | Timestamp | サーバータイムスタンプ |
| `updatedAt` | Timestamp | サーバータイムスタンプ。`updateTask()`が呼ばれるたびに更新 |

補足: READMEに記載の `time`, `duration`, `location`, `autoResetDate` は初期設計時のフィールド案で、
現行の [js/db.js](../js/db.js) / [js/app.js](../js/app.js) の実装では使われていない
（`utils.js` の `PLACE_COLORS` 等、`location` タグ関連のユーティリティのみ残存）。

## `users/{uid}/projects/{projectId}`

| フィールド | 型 | 説明 |
|---|---|---|
| `title` | string | プロジェクト名 |
| `color` | string | Hexカラー。新規作成時は12色パレット（[js/app.js](../js/app.js) `PROJECT_COLORS`）から自動割り当て、手動選択UIは無い |
| `dueDate` | string \| null | `"YYYY-MM-DD"`。過去日はUIで警告色表示 |
| `open` | boolean | プロジェクトカードの展開状態。UIの表示だけでなくFirestoreにも保存し、他デバイスに同期する |
| `childTaskIds` | array | `addProject()`時に空配列で初期化されるが、現行実装では読み取り側は使っていない（タスク側の`projectId`で逆引きしている） |
| `createdAt` | Timestamp | サーバータイムスタンプ |

**進捗％は保存しない派生値**: プロジェクトの完了率は `tasks` コレクションから
`projectId`が一致するものを都度フィルタして算出する（`renderProjectsScreen`内）。

## 同期の仕組み

- [js/db.js](../js/db.js) の `subscribeToTasks` / `subscribeToProjects` が `onSnapshot` で
  リアルタイム購読する。ローカルの楽観的更新は行わず、Firestoreからの通知が届いて初めて
  画面に反映される（多少のレイテンシがあるが、複数デバイス間の整合性が単純に保てる）。
- `enableIndexedDbPersistence`（[js/firebase-config.js](../js/firebase-config.js)）により
  オフラインでも直前のデータはキャッシュから読める。複数タブで開くと有効化に失敗することがあるが
  致命的ではないため無視している。
