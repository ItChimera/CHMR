@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20+ is required to build CHMR installers.
  echo Download Node.js free at https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing CHMR web dependencies...
  call npm install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Building CHMR static bundle...
call npm run build
if errorlevel 1 (
  pause
  exit /b 1
)

if not exist "desktop\node_modules\electron-builder" (
  echo Installing Electron desktop builder...
  call npm --prefix desktop install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)

echo Packaging CHMR-Setup.exe and CHMR-Portable.exe into release\ ...
call npm --prefix desktop run dist:win
if errorlevel 1 (
  pause
  exit /b 1
)

echo.
echo Build complete! Your downloadable .exe files are ready in the "release" folder.
explorer release
pause
