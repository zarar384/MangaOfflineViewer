@echo off
:: рабочая директория на папку скрипта
cd /d %~dp0

:: проверка наличия node - TODO: надо вводить свой путь
set "NODE_PATH=C:\Program Files\nodejs\node.exe"
if not exist "%NODE_PATH%" (
    echo node not found at "%NODE_PATH%". Please install Node.js or fix the path.
    pause
    exit /b 1
)

:: создать папку логов
set "LOG_DIR=logs"
set "LOG_FILE=%LOG_DIR%\server.log"

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

:: переход в папку сервера
cd server

:: запуск server.js с логированием
"%NODE_PATH%" server.js >> "..\%LOG_FILE%" 2>&1
