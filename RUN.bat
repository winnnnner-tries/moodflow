@echo off
:: Start Backend in a new window
start "MoodFlow Backend" cmd /k "cd /d "%~dp0backend" && python main.py"

:: Start Calibration Service in a new window
start "MoodFlow Calibration Service" cmd /k "cd /d "%~dp0calibration_service" && npm start"

:: Start Frontend in a new window
start "MoodFlow Frontend" cmd /k "cd /d "%~dp0frontend" && npm run dev"

echo MoodFlow is starting up! Keep the other windows open while using the website.
pause