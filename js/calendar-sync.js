// Googleカレンダー連携（読み取り専用）。
// Firebase Auth とは別に Google Identity Services (GIS) のトークンクライアントを
// 使ってアクセストークンを取得する。これによりトークンの期限切れ（約1時間）後も
// バックグラウンドで silent 更新でき、リロードしても予定が消えない。

const CLIENT_ID =
  "827266372140-tvt35iutfpev5l8q4qderu6s8ku51hcj.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/calendar.readonly";
const STORAGE_KEY = "hikari_calendar_connected";

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

function ensureTokenClient() {
  if (tokenClient) return true;
  if (typeof google === "undefined" || !google.accounts?.oauth2) return false;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPE,
    callback: () => {}, // リクエストごとに差し替える
  });
  return true;
}

// interactive=true: 同意ダイアログを表示（初回連携・ユーザー操作起点で呼ぶ）
// interactive=false: 既存の許可を使って silent 取得
function requestToken(interactive) {
  return new Promise((resolve, reject) => {
    if (!ensureTokenClient()) {
      reject(new Error("Google Identity Services が読み込まれていません"));
      return;
    }
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(resp);
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (Number(resp.expires_in) - 60) * 1000;
      try {
        localStorage.setItem(STORAGE_KEY, "1");
      } catch (e) {}
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: interactive ? "consent" : "" });
  });
}

async function getToken() {
  if (accessToken && Date.now() < tokenExpiry) return accessToken;
  return requestToken(false);
}

export function isConnected() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch (e) {
    return false;
  }
}

// 初回連携（ユーザーが連携ボタンを押したとき）
export async function connectCalendar() {
  await requestToken(true);
}

export function disconnectCalendar() {
  accessToken = null;
  tokenExpiry = 0;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {}
}

// 指定日（"YYYY-MM-DD"）の予定一覧を取得
// 認証付きGET。401（トークン失効）なら1度だけ silent 再取得して再試行する。
async function authedGet(url) {
  let token = await getToken();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) {
    accessToken = null;
    token = await getToken();
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error("Google API エラー (" + res.status + ")");
  return res.json();
}

// ユーザーが閲覧可能な全カレンダーのID＋色を取得（primaryだけでなく
// 「授業」などの追加カレンダーや購読カレンダーも含む）。
// 色は calendarListEntry.backgroundColor（カレンダーごとにGoogleが割り当てる色）を使う。
async function fetchCalendarList() {
  const data = await authedGet(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250"
  );
  return (data.items || []).map((c) => ({ id: c.id, color: c.backgroundColor || null }));
}

async function fetchEventsForCalendar(calId, timeMin, timeMax, maxResults = 50, color = null) {
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    `&singleEvents=true&orderBy=startTime&maxResults=${maxResults}`;
  return mapEvents(await authedGet(url), color);
}

// 直近の取得状況（診断用）。{ calendars, events, failures }
let lastFetchInfo = { calendars: 0, events: 0, failures: 0 };
export function getLastFetchInfo() {
  return lastFetchInfo;
}

// 指定日（"YYYY-MM-DD"）の予定を全カレンダーから取得して統合
export async function fetchEvents(dateStr) {
  const timeMin = new Date(dateStr + "T00:00:00").toISOString();
  const timeMax = new Date(dateStr + "T23:59:59").toISOString();
  const cals = await fetchCalendarList();
  // カレンダーごとに並列取得。アクセス不可なカレンダーは個別にスキップ。
  const settled = await Promise.allSettled(
    cals.map((c) => fetchEventsForCalendar(c.id, timeMin, timeMax, 50, c.color))
  );
  const all = [];
  let failures = 0;
  let lastErr = null;
  for (const s of settled) {
    if (s.status === "fulfilled") all.push(...s.value);
    else {
      failures++;
      lastErr = s.reason;
    }
  }
  lastFetchInfo = { calendars: cals.length, events: all.length, failures };
  // すべてのカレンダー取得が失敗した場合はエラーとして扱う
  if (all.length === 0 && failures > 0 && failures === cals.length) {
    throw new Error(`全カレンダー取得失敗(${cals.length}件): ${lastErr?.message || lastErr}`);
  }
  all.sort((a, b) => {
    const ka = a.allDay ? "" : a.start;
    const kb = b.allDay ? "" : b.start;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return all;
}

function mapEvents(data, color = null) {
  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || "(無題の予定)",
    allDay: !!ev.start.date,
    start: ev.start.dateTime || ev.start.date,
    end: ev.end?.dateTime || ev.end?.date || null,
    color,
  }));
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

// 予定の開始からローカル日付（YYYY-MM-DD）を求める
function eventDateKey(ev) {
  if (ev.allDay) return ev.start.slice(0, 10); // start.date は既に YYYY-MM-DD
  const d = new Date(ev.start);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 月カレンダー用：日付範囲（"YYYY-MM-DD" 〜 "YYYY-MM-DD"、両端含む）の予定を
// 全カレンダーから取得し、日付キーごとにまとめて返す（{ "YYYY-MM-DD": [ev, ...] }）。
export async function fetchEventsRange(startDateStr, endDateStr) {
  const timeMin = new Date(startDateStr + "T00:00:00").toISOString();
  const timeMax = new Date(endDateStr + "T23:59:59").toISOString();
  const cals = await fetchCalendarList();
  const settled = await Promise.allSettled(
    cals.map((c) => fetchEventsForCalendar(c.id, timeMin, timeMax, 250, c.color))
  );
  const byDate = {};
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const ev of s.value) {
      const key = eventDateKey(ev);
      (byDate[key] ||= []).push(ev);
    }
  }
  // 各日を時刻順（終日は先頭）に整列
  for (const key of Object.keys(byDate)) {
    byDate[key].sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    });
  }
  return byDate;
}
