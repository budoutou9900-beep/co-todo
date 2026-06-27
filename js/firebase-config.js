// Firebase コンソール →「プロジェクトの設定」→「マイアプリ」で取得した値をここに貼ってください。
// この値（apiKey含む）はクライアントに公開されますが、Firestoreセキュリティルールで
// users/{uid} 配下を本人のみアクセス可に制限しているため問題ありません。

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBjT81eGVLFWWlgovF-QfjOPJ19uWvFKOw",
  authDomain: "co-todo-5660c.firebaseapp.com",
  projectId: "co-todo-5660c",
  storageBucket: "co-todo-5660c.firebasestorage.app",
  messagingSenderId: "827266372140",
  appId: "1:827266372140:web:be69d3b694ebec1d98f789",
  measurementId: "G-86ZEL7X168",
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

enableIndexedDbPersistence(db).catch(() => {
  // 複数タブで開いている場合などは失敗するが、致命的ではないので無視する
});
