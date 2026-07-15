# co-todo デスクトップ（細いウィンドウ版）

Chrome の PWA はウィンドウ最小幅（約500 CSS px ＝ 150%スケーリングで約772実px）を
強制するため 380px にできません。この Electron ラッパーは `minWidth` を自由に設定できるので
細い縦長ウィンドウで co-todo を使えます。本番URL（Firebase Hosting）をそのまま読み込みます。

ログインは Google が埋め込みブラウザ内のOAuthをブロックするため、
**システム既定ブラウザでログイン**し、取得したトークンでアプリにサインインします。

---

## セットアップ手順

### 1. Google Cloud で「デスクトップ」OAuthクライアントを作成（初回のみ）

1. https://console.cloud.google.com/ を開き、プロジェクト **co-todo-5660c** を選択
2. 左メニュー「APIとサービス」→「認証情報」
3. 上部「＋ 認証情報を作成」→「OAuth クライアント ID」
4. アプリケーションの種類: **デスクトップ アプリ** / 名前: `co-todo desktop` → 作成
5. 表示された **クライアント ID** と **クライアント シークレット** をコピー
   - ※同じプロジェクト内で作るのが重要（Firebase が自動的にこのトークンを信頼します）
   - ※デスクトップ用クライアントのシークレットは秘匿前提ではないので、main.js に書いてOK

### 2. main.js にクライアント情報を貼り付け

`main.js` の以下2行を、上でコピーした値に置き換える:

```js
const GOOGLE_CLIENT_ID = "PUT_DESKTOP_CLIENT_ID_HERE.apps.googleusercontent.com";
const GOOGLE_CLIENT_SECRET = "PUT_DESKTOP_CLIENT_SECRET_HERE";
```

### 3. アプリ本体（Web）をデプロイ

デスクトップ版は本番URLを読み込むため、`auth.js` の変更を反映する必要があります:

```powershell
cd ..
firebase deploy --only hosting
```

### 4. Electron をインストール（初回のみ）

```powershell
cd desktop
npm install
```

（`electron` 本体を約200MBダウンロードします）

---

## 起動

```powershell
cd desktop
npm start
```

→ 幅380pxの細い窓で開きます。ログインボタンを押すと既定ブラウザでGoogleログインが開き、
完了するとアプリ側が自動でサインインします。

## 幅の調整

`main.js` の `width` / `minWidth`（既定: 380 / 340）を変更してください。

## メモ

- アプリのコードは `auth.js` にデスクトップ用ログイン分岐を1つ追加しただけ。
  `window.desktopAuth` が無いブラウザ/PWAでは従来どおりリダイレクト方式で動きます。
- 読み込み先は `https://co-todo-5660c.web.app`。デプロイすればデスクトップ版にも即反映。
- カレンダー連携（Googleカレンダー表示）もログインと同じくシステムブラウザ + PKCE方式で
  対応済みです。初回のみブラウザで同意すれば、以後はリフレッシュトークン（`calendar-token.json`、
  `userData`フォルダに保存）でブラウザを開かずサイレント更新します。
  同意画面には`calendar.readonly`スコープの権限確認が表示されるため、OAuth同意画面で
  このスコープが有効になっている必要があります（Web版で既に使用中のスコープなので、
  同一GCPプロジェクトなら追加設定は通常不要です）。
