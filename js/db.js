import {
  collection,
  doc,
  onSnapshot,
  addDoc,
  updateDoc,
  deleteDoc,
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
