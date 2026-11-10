@echo off
setlocal
cd /d "%~dp0" || goto failed

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" -B -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
    if not errorlevel 1 goto venv
)
python -B -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 goto python
py -3 -B -c "import sys; sys.exit(sys.version_info < (3, 9))" >nul 2>&1
if not errorlevel 1 goto launcher

echo Python 3.9 or newer is required. Install it before the offline demo.
goto failed

:venv
".venv\Scripts\python.exe" -B start_demo.py
goto finished

:python
python -B start_demo.py
goto finished

:launcher
py -3 -B start_demo.py

:finished
if not errorlevel 1 exit /b 0

:failed
echo CampusCare could not start. See the message above.
pause
exit /b 1
