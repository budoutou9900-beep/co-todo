@echo off
rem co-todo デスクトップ版 ワンクリック起動
rem 初回は依存をインストールしてから起動する。
cd /d "%~dp0"
if not exist "node_modules" (
  echo [co-todo] 初回セットアップ: npm install ...
  call npm install
)
call npm start
