@echo off
setlocal
cd /d "%~dp0"
set URL=http://127.0.0.1:3847

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist ".next\BUILD_ID" (
  echo Building the studio. The first run can take a few minutes.
  call npm run build
  if errorlevel 1 (
    echo The build failed.
    pause
    exit /b 1
  )
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "exit (& { $c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 3847); 0 } catch { 1 } finally { $c.Dispose() } })"
if errorlevel 1 (
  start "Disk Usage Analyzer 3D" /MIN "%~dp0server.cmd"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ok=$false; foreach($i in 1..40){ $c = New-Object System.Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1', 3847); $ok=$true } catch { Start-Sleep -Milliseconds 500 } finally { $c.Dispose() }; if($ok){ break } }; if(-not $ok){ exit 1 }"
  if errorlevel 1 (
    echo The studio did not start. Check the Disk Usage Analyzer 3D window.
    pause
    exit /b 1
  )
)

start "" "%URL%"
endlocal
