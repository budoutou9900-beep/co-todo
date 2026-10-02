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

// WMO Weather interpretation codes → 表示用の絵文字＋ラベル。
// https://open-meteo.com/en/docs の daily.weathercode 参照（コード範囲は仕様通り）。
const WEATHER_CODE_MAP = [
  { max: 0, icon: "☀️", label: "快晴" },
  { max: 1, icon: "🌤️", label: "晴れ" },
  { max: 2, icon: "⛅", label: "晴れ時々くもり" },
  { max: 3, icon: "☁️", label: "くもり" },
  { max: 48, icon: "🌫️", label: "霧" },
  { max: 57, icon: "🌦️", label: "霧雨" },
  { max: 67, icon: "🌧️", label: "雨" },
  { max: 77, icon: "❄️", label: "雪" },
  { max: 82, icon: "🌧️", label: "にわか雨" },
  { max: 86, icon: "🌨️", label: "にわか雪" },
  { max: 99, icon: "⛈️", label: "雷雨" },
];
function weatherCodeInfo(code) {
  if (code == null) return { icon: "—", label: "" };
  const found = WEATHER_CODE_MAP.find((m) => code <= m.max);
  return found ? { icon: found.icon, label: found.label } : { icon: "—", label: "" };
}

// 今日から7日分の天気予報（降水確率・気温・天気アイコン/ラベル）を取得し、
// 日付キーごとにまとめて返す
// { "YYYY-MM-DD": { precipProb, code, icon, label, tempMax, tempMin } }
export async function fetchDailyForecast() {
  const loc = getLocation();
  if (!loc) throw new Error("天気連携の位置情報がありません。連携をONにし直してください");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
    `&daily=precipitation_probability_max,weathercode,temperature_2m_max,temperature_2m_min` +
    `&timezone=auto&forecast_days=7`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("天気予報の取得に失敗しました (" + res.status + ")");
  const data = await res.json();
  const days = data.daily?.time || [];
  const probs = data.daily?.precipitation_probability_max || [];
  const codes = data.daily?.weathercode || [];
  const tempsMax = data.daily?.temperature_2m_max || [];
  const tempsMin = data.daily?.temperature_2m_min || [];
  const byDate = {};
  days.forEach((dateStr, i) => {
    const code = codes[i] ?? null;
    byDate[dateStr] = {
      precipProb: probs[i] ?? 0,
      code,
      ...weatherCodeInfo(code),
      tempMax: tempsMax[i] ?? null,
      tempMin: tempsMin[i] ?? null,
    };
  });
  return byDate;
}
