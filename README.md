# ひかり — 個人用タスク管理PWA

スマホ・PC両方から同じURLでアクセスでき、Firestoreでリアルタイムに同期するタスク管理アプリ。
デザインは「静けさ・光・余白・集中」をキーワードにしたダークモードUI（[Personal task management app UI.zip](./Personal%20task%20management%20app%20UI.zip) のデザインリファレンスに準拠）。

## セットアップ

### 1. Firebase プロジェクトを作成

1. https://console.firebase.google.com にアクセスし、Googleアカウントでログイン
2. 「プロジェクトを作成」→ 任意の名前（例: `task-app`）
3. 左メニュー「Firestore Database」→「データベースを作成」→ 本番環境モード / リージョン: `asia-northeast1`（東京）
4. 左メニュー「Authentication」→「始める」→ Googleプロバイダを有効化
5. 左メニュー「プロジェクトの設定」→「マイアプリ」→ ウェブアプリを追加 → 表示された `firebaseConfig` をコピー

### 2. firebaseConfig を貼る

[js/firebase-config.js](js/firebase-config.js) の `firebaseConfig` オブジェクトに、上でコピーした値を貼り付けます。

### 3. Firestore セキュリティルールを設定

Firebase コンソール → Firestore Database →「ルール」タブに [firestore.rules](firestore.rules) の内容を貼り付けて公開します。
（`users/{uid}` 配下は本人のみ読み書き可能というルールです。）

### 4. ローカルで確認

ES Modules を使っているため `file://` では動作しません。簡易サーバーで配信してください。

```bash
python -m http.server 8080
# → http://localhost:8080 を開く
```

### 5. GitHub Pages にデプロイ

1. GitHubにリポジトリを作成し、このディレクトリの内容をプッシュ
2. リポジトリの Settings → Pages → Branch: `main` / `root` を設定
3. `https://{ユーザー名}.github.io/{リポジトリ名}/` でアクセス可能
4. スマホのSafari/ChromeでそのURLを開き「ホーム画面に追加」するとPWAとして動作します

## ファイル構成

```
/
├── index.html          画面シェル（ログイン / アプリ本体 / タブバー）
├── manifest.json        PWA設定
├── sw.js                 Service Worker（オフラインキャッシュ）
├── firestore.rules       Firestore セキュリティルール
├── css/style.css         デザイントークン・全コンポーネントスタイル
├── js/
│   ├── firebase-config.js  Firebase初期化
│   ├── auth.js              Googleログイン/ログアウト・認証状態監視
│   ├── db.js                 Firestore CRUD・リアルタイム同期
│   ├── tasks.js              繰り返しタスクのロジック・日付リセット
│   ├── calendar.js           週ストリップ・今週ビューの描画
│   ├── timeline.js           今日のタイムライン描画
│   ├── utils.js               日付・場所タグなどの共通ユーティリティ
│   └── app.js                  画面制御・儀式モード・ボトムシート・イベント管理
└── icons/                PWAアイコン
```

## データモデル（Firestore）

```
users/{uid}/tasks/{taskId}
  title, date, time, duration, location("lab"|"home"|"transit"|null),
  projectId, done, repeat{type, days, interval}, autoResetDate,
  createdAt, updatedAt

users/{uid}/projects/{projectId}
  title, color, dueDate, open, createdAt
```

進捗％は紐づくタスク（`projectId` が一致するタスク）の完了数から導出される派生値で、保存はしません。
