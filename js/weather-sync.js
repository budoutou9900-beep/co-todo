// 天気連携（傘リマインダー用）。
// Open-Meteo（https://open-meteo.com/）はAPIキー不要・無料で降水確率が取得できるため、
// Googleカレンダー連携と違いOAuthは無く、ブラウザのGeolocation APIで取得した現在地の
// 緯度経度だけをlocalStorageに保存して使う。

const CONNECTED_KEY = "hikari_weather_connected";
const LOCATION_KEY = "hikari_weather_location"; // { lat, lon }

// この値以上の降水確率（%）なら傘リマインダーを表示する
export const RAIN_THRESHOLD = 50;

export function isConnected() {
  try {
    return localStorage.getItem(CONNECTED_KEY) === "1";
  } catch (e) {
    return false;
  }
}

function getLocation() {
  try {
    const raw = localStorage.getItem(LOCATION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function saveLocation(lat, lon) {
  try {
    localStorage.setItem(LOCATION_KEY, JSON.stringify({ lat, lon }));
  } catch (e) {}
}

// ユーザーが天気連携ボタンを押したときに呼ぶ。ブラウザの位置情報許可ダイアログが出る。
export function connectWeather() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("この環境では位置情報が使えません"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        saveLocation(pos.coords.latitude, pos.coords.longitude);
        try {
          localStorage.setItem(CONNECTED_KEY, "1");
        } catch (e) {}
        resolve();
      },
      (err) => reject(new Error(err.message || "位置情報の取得に失敗しました")),
      { timeout: 10000 }
    );
  });
}

export function disconnectWeather() {
  try {
    localStorage.removeItem(CONNECTED_KEY);
    localStorage.removeItem(LOCATION_KEY);
  } catch (e) {}
}

// 今日から7日分の降水確率（日次最大値）を取得し、日付キーごとにまとめて返す
// { "YYYY-MM-DD": { precipProb: number, code: number } }
export async function fetchDailyForecast() {
  const loc = getLocation();
  if (!loc) throw new Error("天気連携の位置情報がありません。連携をONにし直してください");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&daily=precipitation_probability_max,weathercode&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("天気予報の取得に失敗しました (" + res.status + ")");
  const data = await res.json();
  const days = data.daily?.time || [];
  const probs = data.daily?.precipitation_probability_max || [];
  const codes = data.daily?.weathercode || [];
  const byDate = {};
  days.forEach((dateStr, i) => {
    byDate[dateStr] = { precipProb: probs[i] ?? 0, code: codes[i] ?? null };
  });
  return byDate;
}
