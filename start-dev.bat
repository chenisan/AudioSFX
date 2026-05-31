@echo off
title 13SoulMU Dev Server
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm not found. Make sure Node.js is installed and in PATH.
    pause
    exit /b 1
)

npm run dev
if errorlevel 1 (
    echo.
    echo [ERROR] npm run dev failed. See above for details.
    pause
)
