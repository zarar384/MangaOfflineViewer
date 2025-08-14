@echo off
set LOG_DIR="..\MangaOfflineViewer\logs"
set LOG_FILE="%LOG_DIR%\manga-server.log"

if not exist %LOG_DIR% mkdir %LOG_DIR%
npx live-server "src" --host=0.0.0.0 --port=51234 > %LOG_FILE% 2>&1
