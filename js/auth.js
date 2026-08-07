import {
  GoogleAuthProvider,
  signInWithCredential,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

// Web版のログインは、Firebase Authの signInWithPopup/signInWithRedirect を使わず、
// Google Identity Services (GIS) の「Googleでログイン」ボタンで直接IDトークンを取得し
// signInWithCredential に渡す方式にしている。
// signInWithPopup/signInWithRedirectは内部で authDomain 上の中継iframe・別ウィンドウとの
// postMessage通信を使うが、Safari 16.1+ 等のサードパーティストレージ制限によりこの中継が
// 壊れ、ログイン後に auth/internal-error になって延々ログイン画面に戻るループが起きる不具合が
// あった（popup/redirectいずれも同様、アカウントを変えても再現、Google Cloud側の設定は
// 正常であることを確認済み）。GISのボタンは中継iframeを使わずGoogle純正のUIから直接ID
// トークンを発行するため、この問題を受けない
// （https://firebase.google.com/docs/auth/web/redirect-best-practices の Option 2）。
// デスクトップ版(Electronラッパー)は従来通り、Googleが埋め込みブラウザのOAuthを弾くため
// システムブラウザでトークンを取得して signInWithCredential する。
const WEB_CLIENT_ID = "827266372140-tvt35iutfpev5l8q4qderu6s8ku51hcj.apps.googleusercontent.com";

let gisReady = false;
function ensureGisInitialized(onCredential) {
  if (gisReady) return true;
  if (typeof google === "undefined" || !google.accounts?.id) return false;
  google.accounts.id.initialize({
    client_id: WEB_CLIENT_ID,
    callback: (resp) => onCredential(resp.credential),
  });
  gisReady = true;
  return true;
}

// #google-signin-btn にGoogle純正の「Googleでログイン」ボタンを描画する。
// GISスクリプトは<script async>で読み込んでいるため、まだ読み込み中の場合は
// 準備できるまで待ってから描画する。
export function renderGoogleSignInButton(container, onError) {
  const onCredential = async (idToken) => {
    try {
      const cred = GoogleAuthProvider.credential(idToken);
      await signInWithCredential(auth, cred);
    } catch (e) {
      console.error("ログインに失敗しました", e);
      if (onError) onError(e);
    }
  };
  const tryRender = (attempt = 0) => {
    if (ensureGisInitialized(onCredential)) {
      google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "filled_black",
        size: "large",
        shape: "pill",
        text: "signin_with",
        logo_alignment: "left",
        width: 240,
      });
      return;
    }
    if (attempt >= 25) return; // 約5秒で諦める
    setTimeout(() => tryRender(attempt + 1), 200);
  };
  tryRender();
}

// デスクトップ版（Electronラッパー）専用のログイン。
export async function signInDesktop() {
  const { idToken, accessToken } = await window.desktopAuth.googleOAuth();
  const cred = GoogleAuthProvider.credential(idToken, accessToken);
  await signInWithCredential(auth, cred);
}

export async function signOutUser() {
  await firebaseSignOut(auth);
}

export function watchAuth(callback) {
  return onAuthStateChanged(auth, (user) => callback(user));
}
