@echo off
title YT-Downloader Pro
color 0b

:: B11: Always cd to the script's own directory first
cd /d "%~dp0"

echo ==========================================
echo Starting YT-Downloader Pro...
echo ==========================================

if not exist node_modules\ (
    echo [INFO] First time setup: Installing dependencies...
    :: B11: Use npm install (respects lockfile), not npm install express cors
    call npm install
)

:: B11: Only kill the Node process already listening on port 3000, not every node.exe
echo [INFO] Stopping any existing server on port 3000...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr :3000 ^| findstr LISTENING') do (
    taskkill /F /PID %%p >nul 2>&1
)

echo [INFO] Server running! You can minimize this window.
echo ------------------------------------------

:: B11: Open browser AFTER a short delay so the server is ready
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"

node server.js
pause
