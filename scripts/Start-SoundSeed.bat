@echo off
setlocal
where py >nul 2>nul
if not errorlevel 1 (
  py -3 --version >nul 2>nul
  if not errorlevel 1 (
    py -3 "%~dp0start.py" %*
    goto finish
  )
)
where python3 >nul 2>nul
if not errorlevel 1 (
  python3 --version >nul 2>nul
  if not errorlevel 1 (
    python3 "%~dp0start.py" %*
    goto finish
  )
)
echo SoundSeed needs Python 3.8 or newer.
echo Install Python 3 from https://www.python.org/downloads/ and try again.
echo During installation, enable the Python launcher or add Python to PATH.
pause
exit /b 1

:finish
if errorlevel 1 pause
endlocal
