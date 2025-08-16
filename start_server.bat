@echo off
:: рабочая директория на папку скрипта
cd /d %~dp0

:: запуск только от администратора
@REM net session >nul 2>&1
@REM if %errorlevel% neq 0 (
@REM     echo This script must be run as Administrator!
@REM     pause
@REM     exit /b 1
@REM )

:: проверка наличия npm
set "NPM_PATH=C:\Program Files\nodejs\npm.cmd"
if not exist "%NPM_PATH%" (
    echo npm not found at "%NPM_PATH%". Please install Node.js or fix the path.
    pause
    exit /b 1
)

:: создать папку логов
set "LOG_DIR=..\MangaOfflineViewer\logs"
set "LOG_FILE=%LOG_DIR%\manga-server.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: запуск скрипта для настройки сертификатов
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "..\MangaOfflineViewer\cert\setup_ssl_localhost_certs.ps1" >> "%LOG_FILE%" 2>&1

if %errorlevel% neq 0 (
    echo Certificate setup failed. Check the log at %LOG_FILE%.  >> "%LOG_FILE%" 2>&1
    exit 1
)

:: запуск сервера через npm с логированием
cd /d "..\MangaOfflineViewer"
"%NPM_PATH%" run start > "%LOG_FILE%" 2>>&1
