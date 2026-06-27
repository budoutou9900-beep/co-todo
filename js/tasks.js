import { addTask, updateTask } from "./db.js";
import { todayStr, addDays } from "./utils.js";

export function calcNextDate(task) {
  const base = task.date || todayStr();
  if (task.repeat?.type === "interval") {
    return addDays(base, task.repeat.interval || 1);
  }
  if (task.repeat?.type === "weekly") {
    const days = task.repeat.days || [];
    for (let i = 1; i <= 7; i++) {
      const d = addDays(base, i);
      if (days.includes(new Date(d + "T00:00:00").getDay())) return d;
    }
  }
  return null;
}

export async function completeTask(task) {
  await updateTask(task.id, { done: true });

  if (task.repeat && task.repeat.type !== "none") {
    const nextDate = calcNextDate(task);
    if (nextDate) {
      const { id, done, ...rest } = task;
      await addTask({ ...rest, date: nextDate, done: false });
    }
  }
}

export async function checkDateReset(tasks) {
  const today = todayStr();
  for (const task of tasks) {
    if (task.autoResetDate && task.date && task.date <= today && !task.done) {
      await updateTask(task.id, { date: null });
    }
  }
}
