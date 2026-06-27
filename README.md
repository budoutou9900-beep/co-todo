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

> `authDomain` を `.web.app` にしているため、ローカルでも Google ログインは
> 本番の認証ドメイン経由で処理されます。`localhost` は Firebase Authentication の
> 「承認済みドメイン」に既定で含まれているため、そのままログインできます。

### 5. Firebase Hosting にデプロイ

> **なぜ GitHub Pages ではなく Firebase Hosting か**
> GitHub Pages（`github.io`）にデプロイすると、アプリのドメインと認証ドメイン
> （`firebaseapp.com`）が別になり、iOS Safari のクロスサイトトラッキング防止(ITP)
> によってログイン後に認証状態が引き継がれず「ログインループ」が発生します。
> Firebase Hosting を使い `authDomain` をホスティングのドメインに揃えることで、
> 認証フローが同一ドメイン内で完結し、この問題を回避できます。

1. Node.js（LTS）をインストール後、Firebase CLI を入れる
   ```bash
   npm install -g firebase-tools
   ```
2. ログイン（初回のみ・ブラウザが開く）
   ```bash
   firebase login
   ```
3. このディレクトリでデプロイ（`.firebaserc` / `firebase.json` は同梱済み）
   ```bash
   firebase deploy --only hosting
   ```
4. デプロイ完了後に表示される `https://{プロジェクトID}.web.app` でアクセス可能
5. スマホの Safari/Chrome でそのURLを開き「ホーム画面に追加」すると PWA として動作します

#### 認証ドメインの設定（重要）

`authDomain` をホスティングの `.web.app` ドメインに変更しているため、
Google Cloud Console 側でリダイレクト先の登録が必要です。

1. https://console.cloud.google.com/apis/credentials （対象プロジェクトを選択）
2. 「OAuth 2.0 クライアント ID」→「Web client (auto created by Google Service)」を開く
3. **承認済みの JavaScript 生成元** に追加: `https://{プロジェクトID}.web.app`
4. **承認済みのリダイレクト URI** に追加: `https://{プロジェクトID}.web.app/__/auth/handler`
5. 保存（反映に数分かかることがあります）

> このプロジェクトの本番URL: **https://co-todo-5660c.web.app**

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
