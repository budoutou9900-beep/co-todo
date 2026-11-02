// 起動時のテーマのちらつき防止。Firestoreの設定を待たず、前回適用したテーマを描画前に当てる。
// CSPでインラインscriptを許可していないため外部ファイルにしている。stylesheetの<link>より後に
// 同期読み込みすることで、CSSが適用済みの状態で --bg を読んでステータスバー色も合わせられる。
// 正しいテーマは app.js がFirestoreの users/{uid}/settings/appearance を読んで上書きする。
(function () {
  var id = null;
  try {
    id = localStorage.getItem("buto-do-theme");
  } catch (e) {}
  if (!id || id === "default") return;
  document.documentElement.setAttribute("data-theme", id);
  var bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta && bg) meta.setAttribute("content", bg);
})();
