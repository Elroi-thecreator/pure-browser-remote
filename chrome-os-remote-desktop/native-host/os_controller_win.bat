@echo off
REM Windows Native Messaging wrapper for Chrome OS Remote Desktop Host
REM Uses -u for unbuffered binary stdio communication

py -3 --version >nul 2>&1
if %ERRORLEVEL% equ 0 (
    py -3 -u "%~dp0os_controller.py"
) else (
    python -u "%~dp0os_controller.py"
)
