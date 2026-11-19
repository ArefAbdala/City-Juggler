@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

:: =========================================================================
:: Flight Finder — Windows launcher
:: =========================================================================

:: --- [1/5] Check Python ---
echo [1/5] Checking Python...

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PY=py -3"
    goto :found_python
)

python --version >nul 2>&1
if not errorlevel 1 (
    set "PY=python"
    goto :found_python
)

echo.
echo ERROR: Python not found.
echo Install Python 3.10 or newer from https://www.python.org/downloads/
echo Make sure to tick "Add Python to PATH" during installation.
echo.
pause
exit /b 1

:found_python
:: --- [2/5] Check Python version (>= 3.10) ---
echo [2/5] Checking Python version...

for /f "tokens=2 delims= " %%v in ('!PY! --version 2^>^&1') do set "PYVER=%%v"
for /f "tokens=1,2 delims=." %%a in ("!PYVER!") do (
    set "PYMAJ=%%a"
    set "PYMIN=%%b"
)

if !PYMAJ! LSS 3 goto :bad_version
if !PYMAJ! EQU 3 if !PYMIN! LSS 10 goto :bad_version
echo    Found Python !PYVER!
goto :version_ok

:bad_version
echo.
echo ERROR: Python !PYVER! is too old. fast-flights requires Python 3.10 or newer.
echo Download it from https://www.python.org/downloads/loo
echo.
pause
exit /b 1

:version_ok

:: --- [3/5] Create virtual environment ---
echo [3/5] Setting up virtual environment...

if not exist ".venv\Scripts\python.exe" (
    echo    Creating .venv...
    !PY! -m venv .venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        pause
        exit /b 1
    )
    echo    Upgrading pip...
    .venv\Scripts\python -m pip install --upgrade pip -q
)

:: --- [4/5] Install dependencies (only when requirements.txt changes) ---
echo [4/5] Checking dependencies...

set "HASH_FILE=.venv\.req_hash"
set "NEED_INSTALL=0"

:: Compute hash of requirements.txt
for /f "tokens=*" %%h in ('certutil -hashfile requirements.txt MD5 2^>nul ^| findstr /v "hash certutil"') do (
    set "CURRENT_HASH=%%h"
)

if not exist "!HASH_FILE!" (
    set "NEED_INSTALL=1"
) else (
    set /p SAVED_HASH=<"!HASH_FILE!"
    if not "!SAVED_HASH!"=="!CURRENT_HASH!" set "NEED_INSTALL=1"
)

if "!NEED_INSTALL!"=="1" (
    echo    Installing requirements...
    .venv\Scripts\python -m pip install -r requirements.txt -q
    if errorlevel 1 (
        echo ERROR: Failed to install dependencies.
        pause
        exit /b 1
    )
    echo !CURRENT_HASH!> "!HASH_FILE!"
    echo    Done.
) else (
    echo    Dependencies up to date.
)

:: --- [5/5] Start server ---

:: Demo mode?
set "DEMO_FLAG="
if /i "%~1"=="demo" (
    set "FLIGHTS_DEMO=1"
    set "DEMO_FLAG= [DEMO MODE]"
    echo.
    echo    *** DEMO MODE — sample data, no network calls ***
)

:: Find open port
set "PORT=8000"
netstat -ano 2>nul | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
    set "PORT=8001"
    netstat -ano 2>nul | findstr ":8001 " | findstr "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        set "PORT=8002"
    )
)

echo.
echo [5/5] Starting Flight Finder on http://127.0.0.1:!PORT!!DEMO_FLAG!
echo    Press Ctrl+C to stop.
echo.

:: Open browser after a short delay
start "" cmd /c "timeout /t 2 /nobreak >nul & start "" http://127.0.0.1:!PORT!"

:: Run server in foreground
.venv\Scripts\python -m uvicorn app:app --host 127.0.0.1 --port !PORT!

if errorlevel 1 (
    echo.
    echo ERROR: Server exited unexpectedly.
    pause
    exit /b 1
)

endlocal
