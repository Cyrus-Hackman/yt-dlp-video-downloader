@echo off
title YT-Downloader Pro
color 0b

:: Fix 4 / B11: Always cd to the script's own directory first
cd /d "%~dp0"

echo ==========================================
echo Starting YT-Downloader Pro...
echo ==========================================

if not exist node_modules\ (
    echo [INFO] First time setup: Installing dependencies...
    call npm install
)

:: Fix 4: Only kill a Node process already listening on port 3789 (exact match, not :30xx)
echo [INFO] Stopping any existing server on port 3789...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /C:":3789 " ^| findstr LISTENING 2^>nul') do (
    tasklist /FI "PID eq %%p" 2>nul | findstr /I "node.exe" >nul 2>&1
    if not errorlevel 1 (
        echo [INFO] Killing node.exe on PID %%p
        taskkill /F /PID %%p >nul 2>&1
    )
)

echo [INFO] Server running! You can minimize this window.
echo ------------------------------------------

:: B11: Open browser after a short delay so the server is ready
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3789"

node server.js
pause
