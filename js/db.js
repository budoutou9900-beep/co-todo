import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";

function uid() {
  return auth.currentUser?.uid;
}

function tasksRef() {
  return collection(db, "users", uid(), "tasks");
}

function projectsRef() {
  return collection(db, "users", uid(), "projects");
}

export function subscribeToTasks(callback) {
  const q = query(tasksRef(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToProjects(callback) {
  const q = query(projectsRef(), orderBy("createdAt", "desc"));
  return onSnapshot(q, (snapshot) => {
    callback(snapshot.docs.map((d) => ({ id: d.id, ...d.data() })));
  });
}

export async function addTask(taskData) {
  return addDoc(tasksRef(), {
    ...taskData,
    done: false,
    // 並び替え用。新規は末尾に来るように現在時刻のms。手動並び替え時はこの値を
    // 隣接2タスクの中間値に書き換える（drag.js）。
    order: taskData.order ?? Date.now(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateTask(taskId, changes) {
  const ref = doc(db, "users", uid(), "tasks", taskId);
  await updateDoc(ref, { ...changes, updatedAt: serverTimestamp() });
}

export async function deleteTask(taskId) {
  const ref = doc(db, "users", uid(), "tasks", taskId);
  await deleteDoc(ref);
}

export async function addProject(projectData) {
  return addDoc(projectsRef(), {
    ...projectData,
    childTaskIds: projectData.childTaskIds || [],
    createdAt: serverTimestamp(),
  });
}

export async function updateProject(projectId, changes) {
  const ref = doc(db, "users", uid(), "projects", projectId);
  await updateDoc(ref, changes);
}

export async function deleteProject(projectId) {
  const ref = doc(db, "users", uid(), "projects", projectId);
  await deleteDoc(ref);
}

// 見た目の設定（着せ替えテーマ）。端末をまたいで引き継ぐため users/{uid}/settings/appearance に置く。
// ドキュメントが無い・themeId 未設定のときは null を渡し、読み取り側で default 扱いにする。
function appearanceRef() {
  return doc(db, "users", uid(), "settings", "appearance");
}

export function subscribeToAppearance(callback) {
  return onSnapshot(appearanceRef(), (snap) => {
    // キャッシュに無いだけの「存在しない」通知で一瞬 default に戻ってちらつかないよう、サーバー応答を待つ
    if (!snap.exists() && snap.metadata.fromCache) return;
    callback(snap.exists() ? snap.data().themeId ?? null : null);
  });
}

export async function saveThemeId(themeId) {
  await setDoc(appearanceRef(), { themeId }, { merge: true });
}
