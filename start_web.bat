@echo off
setlocal EnableExtensions

set "ROOT_DIR=%~dp0"
set "WEB_DIR=%ROOT_DIR%web"
set "LOCK_FILE=%WEB_DIR%\.next\dev\lock"
set "APP_PORT=%NR1_WEB_PORT%"

if "%APP_PORT%"=="" (
  set "APP_PORT=3100"
)

if not exist "%WEB_DIR%\package.json" (
  echo [ERROR] Could not find web\package.json in "%WEB_DIR%".
  goto :fail
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm was not found in PATH.
  echo Install Node.js 20+ and reopen the terminal.
  goto :fail
)

pushd "%WEB_DIR%"
if errorlevel 1 (
  echo [ERROR] Failed to enter "%WEB_DIR%".
  goto :fail
)

:find_open_port
netstat -ano -p tcp | findstr /R /C:":%APP_PORT% .*LISTENING" >nul
if %ERRORLEVEL%==0 (
  echo [WARN] Port %APP_PORT% is already in use. Trying next port...
  set /a "APP_PORT+=1"
  goto :find_open_port
)

if not exist ".env.local" (
  echo [WARN] web\.env.local not found. The app may fail until environment variables are configured.
)

if exist "%LOCK_FILE%" (
  echo [INFO] Found existing Next.js dev lock. Attempting cleanup...
  del /f /q "%LOCK_FILE%" >nul 2>&1
  if exist "%LOCK_FILE%" (
    echo [ERROR] Could not remove "%LOCK_FILE%".
    echo Close any running "next dev" process, then run this script again.
    popd
    goto :fail
  )
  echo [INFO] Removed stale lock file.
)

if not exist "node_modules" (
  echo Installing dependencies in web\ ...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    goto :fail
  )
)

echo Starting Work Vital - saude corporativa web app on http://localhost:%APP_PORT% ...
call npm run dev -- --port %APP_PORT%
set "EXIT_CODE=%ERRORLEVEL%"

popd

if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The web server exited with code %EXIT_CODE%.
  echo Check the logs above for the exact cause.
  goto :fail_with_code
)

exit /b 0

:fail_with_code
set "FAILED_CODE=%EXIT_CODE%"
echo Press any key to close this window.
pause >nul
exit /b %FAILED_CODE%

:fail
echo Press any key to close this window.
pause >nul
exit /b 1
