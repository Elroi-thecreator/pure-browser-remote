@echo off
setlocal enabledelayedexpansion

echo ======================================================================
echo    Chrome OS Remote Desktop - Windows Native Host 1-Click Installer   
echo ======================================================================
echo.

:: 1. Verify Python availability (prefer Python 3 launcher)
py -3 --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set PIP_CMD=py -3 -m pip
    echo [1/4] Python 3 Launcher detected (py -3).
) else (
    python --version >nul 2>&1
    if %ERRORLEVEL% equ 0 (
        set PIP_CMD=pip
        echo [1/4] Python executable detected in PATH.
    ) else (
        echo [ERROR] Python is not found in your system PATH.
        echo Please install Python 3.8+ from https://www.python.org/ and check
        echo 'Add Python to PATH' during installation.
        pause
        exit /b 1
    )
)

echo Installing required Python packages...
%PIP_CMD% install -r "%~dp0requirements.txt"
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install Python dependencies. Check your internet connection.
    pause
    exit /b 1
)

:: 2. Acquire Chrome Extension ID
set EXT_ID=%~1
if "%EXT_ID%"=="" (
    echo.
    echo Please open chrome://extensions in Chrome, find 'Chrome OS Remote Desktop Host',
    echo and copy the 32-character Extension ID.
    echo.
    set /p EXT_ID="Paste your Chrome Extension ID here: "
)

if "%EXT_ID%"=="" (
    echo [ERROR] No Extension ID provided. Aborting.
    pause
    exit /b 1
)

echo.
echo [2/4] Configuring Native Host for Extension ID: %EXT_ID%

:: 3. Prepare target path with escaped backslashes for JSON
set SCRIPT_DIR=%~dp0
set BAT_PATH=%SCRIPT_DIR%os_controller_win.bat
set ESCAPED_BAT_PATH=%BAT_PATH:\=\\%

set MANIFEST_FILE=%SCRIPT_DIR%com.remote.oscontroller.json

echo [3/4] Generating Chrome Native Messaging Host manifest...
(
    echo {
    echo   "name": "com.remote.oscontroller",
    echo   "description": "Chrome OS Remote Desktop Native Input Injection Host",
    echo   "path": "!ESCAPED_BAT_PATH!",
    echo   "type": "stdio",
    echo   "allowed_origins": [
    echo     "chrome-extension://%EXT_ID%/"
    echo   ]
    echo }
) > "%MANIFEST_FILE%"

:: 4. Add Registry Keys for Chrome & Edge
echo [4/4] Registering Native Messaging Host in Windows Registry...
REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.remote.oscontroller" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to register in Chrome registry.
    pause
    exit /b 1
)

:: Optional Edge support
REG ADD "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.remote.oscontroller" /ve /t REG_SZ /d "%MANIFEST_FILE%" /f >nul 2>&1

echo.
echo ======================================================================
echo  [SUCCESS] Native Messaging Host installed and registered!
echo ======================================================================
echo  Host Manifest: %MANIFEST_FILE%
echo  Target Wrapper: %BAT_PATH%
echo  Authorized Extension: chrome-extension://%EXT_ID%/
echo.
echo You can now return to the Chrome Extension Host tab and click
echo 'Connect Native Host'.
echo ======================================================================
echo.
pause
