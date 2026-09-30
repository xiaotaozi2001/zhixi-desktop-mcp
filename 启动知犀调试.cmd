@echo off
setlocal
set "ELECTRON_RUN_AS_NODE="
set "NODE_OPTIONS="
if not defined ZHIXI_EXE set "ZHIXI_EXE=C:\Program Files\ZhiXi\ZXMind\zhiximind-desktop.exe"
if not defined ZHIXI_DEBUG_PORT set "ZHIXI_DEBUG_PORT=19222"
if not exist "%ZHIXI_EXE%" (
  echo ZhiXi executable not found. Set ZHIXI_EXE and retry.
  pause
  exit /b 1
)
start "" "%ZHIXI_EXE%" --remote-debugging-address=127.0.0.1 --remote-debugging-port=%ZHIXI_DEBUG_PORT%
endlocal
