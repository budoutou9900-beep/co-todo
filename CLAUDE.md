# CLAUDE.md

このファイルはClaude Code（claude.ai/code）がこのリポジトリで作業する際のガイドです。

## プロジェクト概要

**Buto-do**（社内呼称「ひかり」、旧称 co-todo）は個人用のタスク管理PWA。スマホ・PC問わず同じURLでアクセスし、
Firestoreでリアルタイム同期する。ビルドツールなし・フレームワークなしの素のHTML/CSS/JS（ESモジュール）。
デザインは「静けさ・光・余白・集中」をキーワードにしたダークモードUI。

詳しい機能仕様は [docs/FEATURES.md](docs/FEATURES.md)、データモデルは [docs/DATA_MODEL.md](docs/DATA_MODEL.md)、
アーキテクチャは [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## 開発コマンド

ビルドステップは無い。ES Modulesを使うため `file://` では動かず、簡易サーバーで配信する。

```bash
python -m http.server 8766
# → http://localhost:8766 を開く
```

本番デプロイ（Firebase Hosting）:

```powershell
firebase deploy --only hosting
```

デプロイ前にコード変更を `git push` すること（デプロイはgit履歴と独立している）。

## アーキテクチャの要点

- **状態管理**: `js/app.js` の単一 `state` オブジェクトで全画面状態を保持。フレームワークは使わず、
  `state` を書き換えた後に `renderScreen()` を呼んで `innerHTML` を丸ごと再生成する素朴なパターン。
  同一HTML文字列なら再描画をスキップし（`lastRenderedHtml`との比較）、進行中のCSSアニメーションが
  壊れないようにしている。
- **データ層**: `js/db.js` がFirestoreの `users/{uid}/tasks` と `users/{uid}/projects` を
  `onSnapshot` でリアルタイム購読。ローカルの楽観的更新は行わず、Firestoreからの通知を唯一の
  真実源として画面に反映する。
- **認証**: `js/auth.js`。モバイルSafari/PWAはリダイレクト方式、デスクトップ版（Electron）は
  システムブラウザでOAuthしてトークンをFirebaseに渡す方式（`window.desktopAuth.googleOAuth`）。
- **カレンダー連携**: `js/calendar-sync.js` がGoogle Identity Services (GIS) のトークンクライアントで
  読み取り専用スコープ（`calendar.readonly`）のアクセストークンを取得し、Google Calendar API を
  直接fetchする。Firebase Authとは別の認可フローなので、連携ON/OFFの状態は `localStorage` で管理。
- **並び替え**: `js/drag.js` が長押し/ドラッグでの並び替えを担当。汎用化されており今日タブの
  タスクリストにもプロジェクト内タスクにも使われる。並び順は各タスクの `order`（数値）フィールドで、
  隣接2値の中間値を計算して更新する（挿入型ソート）。
- **スワイプ削除**: `js/swipe.js` が左スワイプで削除ボタンを表示する操作を汎用実装。

## コーディング規約・注意点

- **既存のコードコメントの温度感に合わせる**: このリポジトリは「なぜそうしたか」を日本語コメントで
  残すスタイル（バグ修正の背景、iOS/Safari特有の制約への対処など）。新規コードも同様に、
  非自明な理由がある箇所にだけ日本語コメントを残す。
- **iOS Safari / PWA特有の制約が多い**: `safe-area-inset-*`、`signInWithPopup`のブロック、
  `focus()`を同期的に呼ぶ必要がある（キーボード表示のため）など、ここで解決済みの問題を
  再度作り込まないよう、関連コードのコメントを読んでから触ること。
- **Firestoreスキーマはコード側で暗黙に定義**: マイグレーション機構は無いので、フィールドを
  追加する際は「無い場合のデフォルト値」を読み取り側で必ずケアする（例: `t.priority === "extra"`
  のように否定形で判定し、未設定時は自然にデフォルト扱いにする）。
- **`state` は直接ミューテーションしてから `renderScreen()`**: Reactのような差分検出は無いので、
  状態を更新したら明示的に再描画関数を呼ぶ必要がある。Firestoreの `onSnapshot` コールバック内では
  `requestRender()`（rAFでまとめる版）を使う。
- **サービスワーカー (`sw.js`) のキャッシュ対象リスト**: 新しいJSファイルを追加したら `ASSETS`
  配列に追記しないとオフライン時に読み込めない（現状 `swipe.js` が未登録という既知の漏れがある）。
- **`window.prompt()` / `alert()` / `confirm()` は使わない**: デスクトップ版（[desktop/](desktop/)、
  Electron製）では `window.prompt()` がネイティブ実装されておらず、呼び出しても何も表示されず
  即座にnullを返す（＝ボタンが反応しないように見える不具合になる）。ユーザー入力が必要な場面は
  `confirmDeleteProject` や `openProjectModal`（[js/app.js](js/app.js)）のような
  `.confirm-overlay`/`.confirm-sheet` を使ったアプリ内モーダルで実装すること。

## ドキュメント更新ルール（必須）

**仕様に影響する修正を行ったら、同じ作業の中で関連する `docs/` と `README.md` も更新すること。**
コードとドキュメントを別タスクに分けない。実装が終わった時点でドキュメントも終わっている状態にする。

- **画面の挙動・操作方法を変えたら** → [docs/FEATURES.md](docs/FEATURES.md) の該当セクションを更新
  （新機能の追加だけでなく、既存の説明が古くなった場合の修正も含む）。
- **Firestoreのフィールドを追加/変更/廃止したら** → [docs/DATA_MODEL.md](docs/DATA_MODEL.md) の
  該当テーブルを更新。
- **状態管理・データフロー・モジュール構成・認証/連携フローを変えたら** → [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
  を更新。
- **セットアップ手順・デプロイ手順・ファイル構成が変わったら** → [README.md](README.md) を更新。
- **このリポジトリ特有の注意点（ハマりどころ・既知の制約）が増えたら** → この CLAUDE.md の
  「コーディング規約・注意点」に追記。
- ドキュメントの記述が実装と食い違っていることに気づいたら、頼まれていなくても直す
  （例: 未使用になったフィールドの記載を消す、挙動が変わった説明を直す）。
- 些細な内部リファクタ（挙動が変わらない変数名変更や関数分割など）はドキュメント更新不要。
  「ユーザーから見た挙動」「データの形」「今後このコードを触る人が知るべき設計判断」が
  変わったかどうかを基準に判断する。
