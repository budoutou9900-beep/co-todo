// co-todo を細いウィンドウで開く Electron ラッパー。
// Chrome PWA はウィンドウ最小幅（約500 CSS px）を強制するが、Electron は minWidth を
// 自由に設定できるので 380px の細い窓にできる。
//
// ログイン: Google は埋め込みブラウザ内のOAuthをブロックするため、ログインだけは
// 「システム既定ブラウザ」で行う（PKCE + ループバック）。取得したトークンをアプリに渡し、
// アプリ側で Firebase signInWithCredential する。

const { app, BrowserWindow, shell, session, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const crypto = require("crypto");

const APP_URL = "https://co-todo-5660c.web.app";

// 通常の Chrome を名乗る UA（GIS 等の判定対策）
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// OAuthクライアント情報は gitignore した oauth-config.json から読み込む（履歴に残さない）。
// 初回は oauth-config.example.json を複製して値を入れる。
let oauthConfig = {};
try {
  oauthConfig = require("./oauth-config.json");
} catch (e) {
  console.error(
    "[co-todo] desktop/oauth-config.json が見つかりません。oauth-config.example.json を複製し、Google Cloud のデスクトップOAuthクライアントの値を入れてください。"
  );
}
const GOOGLE_CLIENT_ID = oauthConfig.clientId || "";
const GOOGLE_CLIENT_SECRET = oauthConfig.clientSecret || "";

const SCOPES = "openid email profile";

function base64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// システムブラウザで Google OAuth（PKCE + ループバック）。{ idToken, accessToken } を返す。
function googleOAuth() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    let redirectUri = "";
    const server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, redirectUri);
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (!code && !error) {
          res.end("OK");
          return;
        }
        const finish = (html) => {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end(html);
        };
        if (error) {
          finish("<h2>ログインに失敗しました。アプリに戻ってください。</h2>");
          server.close();
          reject(new Error(error));
          return;
        }
        if (url.searchParams.get("state") !== state) {
          finish("<h2>state不一致。やり直してください。</h2>");
          server.close();
          reject(new Error("state mismatch"));
          return;
        }
        finish(
          "<h2>ログインが完了しました。アプリに戻ってください。</h2><script>setTimeout(()=>window.close&&window.close(),300)</script>"
        );
        // 認可コード → トークン交換
        const body = new URLSearchParams({
          code,
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: verifier,
        });
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body,
        });
        const data = await tokenRes.json();
        server.close();
        if (!tokenRes.ok) {
          reject(new Error(data.error_description || data.error || "token exchange failed"));
          return;
        }
        resolve({ idToken: data.id_token, accessToken: data.access_token });
      } catch (e) {
        try {
          server.close();
        } catch (_) {}
        reject(e);
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      redirectUri = `http://127.0.0.1:${port}`;
      const authUrl =
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          redirect_uri: redirectUri,
          response_type: "code",
          scope: SCOPES,
          code_challenge: challenge,
          code_challenge_method: "S256",
          state,
          prompt: "select_account",
        }).toString();
      shell.openExternal(authUrl);
    });

    // 5分でタイムアウト
    setTimeout(() => {
      try {
        server.close();
      } catch (_) {}
      reject(new Error("timeout"));
    }, 5 * 60 * 1000);
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 380,
    height: 820,
    minWidth: 340, // 下限幅。変えればもっと細く/太くできる
    minHeight: 480,
    title: "Buto-do",
    backgroundColor: "#0f0f14",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.webContents.setUserAgent(CHROME_UA);
  win.loadURL(APP_URL, { userAgent: CHROME_UA });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(() => {
  session.defaultSession.setUserAgent(CHROME_UA);
  ipcMain.handle("google-oauth", () => googleOAuth());

  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
