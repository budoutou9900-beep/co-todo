// レンダラー（読み込んだ co-todo Web アプリ）に、システムブラウザでの
// Google ログインを呼び出すための橋を公開する。
// Web アプリ側は window.desktopAuth が存在すればデスクトップ用ログイン経路を使う。
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAuth", {
  // { idToken, accessToken } を返す
  googleOAuth: () => ipcRenderer.invoke("google-oauth"),
  // カレンダー連携（システムブラウザでOAuth）。{ accessToken, expiresIn } を返す
  googleCalendarOAuth: () => ipcRenderer.invoke("google-calendar-connect"),
  // 保存済みリフレッシュトークンでサイレント更新。{ accessToken, expiresIn } か null
  googleCalendarToken: () => ipcRenderer.invoke("google-calendar-token"),
  googleCalendarDisconnect: () => ipcRenderer.invoke("google-calendar-disconnect"),
});
