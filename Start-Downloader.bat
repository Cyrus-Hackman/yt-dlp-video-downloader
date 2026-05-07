@echo off
title YT-Downloader Pro
color 0b
echo ==========================================
echo Starting YT-Downloader Pro...
echo ==========================================

if not exist node_modules\ (
    echo [INFO] First time setup: Installing dependencies...
    call npm install express cors
)

echo [INFO] Stopping any old/frozen Node servers...
taskkill /F /IM node.exe >nul 2>&1

echo [INFO] Opening browser...
start "" "http://localhost:3000"

echo [INFO] Server running! You can minimize this window.
echo ------------------------------------------

node server.js
pause
