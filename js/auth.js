import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut as firebaseSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth } from "./firebase-config.js";

// モバイルSafari/PWA(standalone)では signInWithPopup が
// Google の "disallowed_useragent" 判定でブロックされるため、
// リダイレクト方式に統一する。
export async function signIn() {
  const provider = new GoogleAuthProvider();
  await signInWithRedirect(auth, provider);
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
