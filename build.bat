@echo off
chcp 65001 >nul
cd /d "%~dp0"
call npm install || goto :err
call npm run dist || goto :err
echo.
echo Готово: dist\MisterCraft-Setup.exe
pause
exit /b 0
:err
echo Ошибка сборки. Установите Node.js 20+ с https://nodejs.org
pause
