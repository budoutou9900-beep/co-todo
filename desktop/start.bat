@echo off
rem co-todo desktop launcher (ASCII only: cmd misreads UTF-8 Japanese and breaks the if-block)
cd /d "%~dp0"
if not exist "node_modules" (
  echo [co-todo] first run: npm install ...
  call npm install
)
call npm start
