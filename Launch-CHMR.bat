@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required to run CHMR from source.
  echo Download Node.js free at https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing CHMR web dependencies (first run)...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "dist\index.html" (
  echo Building CHMR interface...
  call npm run build
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

if not exist "desktop\node_modules\electron" (
  echo Installing CHMR native desktop runtime (first run)...
  call npm --prefix desktop install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Launching CHMR Desktop...
call npm --prefix desktop start
