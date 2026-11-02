@echo off
chcp 65001 >nul
cd /d "%~dp0"

where py >nul 2>nul
if errorlevel 1 (
  python -m pip install python-docx
) else (
  py -3 -m pip install python-docx
)

echo.
echo Done. You can close this window.
pause
