@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist node_modules (
  echo Установка зависимостей...
  call npm install || goto :err
)
call npm start
exit /b 0
:err
echo Ошибка установки зависимостей. Установите Node.js 20+ с https://nodejs.org
pause
