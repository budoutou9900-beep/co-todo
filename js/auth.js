import {
  GoogleAuthProvider,
  signInWithRedirect,
  signInWithPopup,
  signInWithCredential,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

// ホーム画面に追加したPWA(standalone)では signInWithPopup が
// Google の "disallowed_useragent" 判定でブロックされるため、
// リダイレクト方式を使う。
// 一方、通常のSafariタブでは逆に signInWithRedirect が問題になる。
// Safari 16.1+ はサードパーティストレージ制限により、redirect方式が内部で
// 使う別ドメインとの中継iframe（authDomainがfirebaseapp.comのサブドメインで
// ない場合に発生）がブロックされ、ログイン後 auth/internal-error になって
// ログイン画面に戻る無限ループが起きる
// （https://firebase.google.com/docs/auth/web/redirect-best-practices）。
// popup方式はウィンドウ間の直接通信(postMessage)のためこの制限を受けない。
// デスクトップ版(Electronラッパー)では Google が埋め込みブラウザのOAuthを
// 弾くため、システムブラウザでトークンを取得して signInWithCredential する。
function isStandalone() {
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

export async function signIn() {
  if (window.desktopAuth?.googleOAuth) {
    const { idToken, accessToken } = await window.desktopAuth.googleOAuth();
    const cred = GoogleAuthProvider.credential(idToken, accessToken);
    await signInWithCredential(auth, cred);
    return;
  }
  const provider = new GoogleAuthProvider();
  if (isStandalone()) {
    await signInWithRedirect(auth, provider);
  } else {
    await signInWithPopup(auth, provider);
  }
}

export async function signOutUser() {
  await firebaseSignOut(auth);
}

export function watchAuth(callback, onError) {
  getRedirectResult(auth).catch((err) => {
    console.error("ログインに失敗しました", err);
    if (onError) onError(err);
  });
  return onAuthStateChanged(auth, (user) => callback(user));
}
