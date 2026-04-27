@echo off
REM WebAPI-Testing — set PORT to match the URL you use in the browser (default 8000)
cd /d "%~dp0"
if not defined PORT set "PORT=8000"

echo.
echo  ========================================================================
echo   WebAPI-Testing — use THIS port in the browser address bar (must match):
echo   http://127.0.0.1:%PORT%/which-app  ^(text: webapi-testing + path to main.py^)
echo   http://127.0.0.1:%PORT%/health     ^(JSON with main_py^)
echo  ========================================================================
echo.
echo Working directory: %CD%
python -c "import pathlib; p = pathlib.Path('main.py').resolve(); print(' main.py here:', p, 'OK' if p.is_file() else 'MISSING')"
python -c "import importlib, pathlib; m = importlib.import_module('main'); print(' import main:', pathlib.Path(m.__file__).resolve())"
echo.
set UVICORN_PORT=%PORT%
python -m uvicorn main:app --host 127.0.0.1 --port %PORT% --reload
pause
