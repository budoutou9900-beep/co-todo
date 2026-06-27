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

// ユーザーが閲覧可能な全カレンダーのIDを取得（primaryだけでなく
// 「授業」などの追加カレンダーや購読カレンダーも含む）
async function fetchCalendarIds() {
  const data = await authedGet(
    "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader&maxResults=250"
  );
  return (data.items || []).map((c) => c.id);
}

async function fetchEventsForCalendar(calId, timeMin, timeMax) {
  const url =
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events` +
    `?timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}` +
    "&singleEvents=true&orderBy=startTime&maxResults=50";
  return mapEvents(await authedGet(url));
}

// 指定日（"YYYY-MM-DD"）の予定を全カレンダーから取得して統合
export async function fetchEvents(dateStr) {
  const timeMin = new Date(dateStr + "T00:00:00").toISOString();
  const timeMax = new Date(dateStr + "T23:59:59").toISOString();
  const calIds = await fetchCalendarIds();
  // カレンダーごとに並列取得。アクセス不可なカレンダーは無視する。
  const results = await Promise.all(
    calIds.map((id) => fetchEventsForCalendar(id, timeMin, timeMax).catch(() => []))
  );
  const all = results.flat();
  all.sort((a, b) => {
    const ka = a.allDay ? "" : a.start;
    const kb = b.allDay ? "" : b.start;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return all;
}

function mapEvents(data) {
  return (data.items || []).map((ev) => ({
    id: ev.id,
    summary: ev.summary || "(無題の予定)",
    allDay: !!ev.start.date,
    start: ev.start.dateTime || ev.start.date,
    end: ev.end?.dateTime || ev.end?.date || null,
  }));
}
