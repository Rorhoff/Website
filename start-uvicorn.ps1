# WebAPI-Testing — $env:PORT = 8000 (or 8001); browser URL must use the same port
# Run: .\start-uvicorn.ps1  (or: $env:PORT=8001; .\start-uvicorn.ps1)
Set-Location $PSScriptRoot
if (-not $env:PORT) { $env:PORT = "8000" }

# Kill any existing processes on this port before starting
$oldPids = (Get-NetTCPConnection -LocalPort $env:PORT -State Listen -ErrorAction SilentlyContinue).OwningProcess | Sort-Object -Unique
if ($oldPids) {
    Write-Host "  Killing old processes on port $($env:PORT): $($oldPids -join ', ')" -ForegroundColor Yellow
    $oldPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Milliseconds 800
}

Write-Host ""
Write-Host " =====================================================================" -ForegroundColor Cyan
Write-Host "  Open in the browser (port must match this process):"
Write-Host "  http://127.0.0.1:$($env:PORT)/which-app" -ForegroundColor Yellow
Write-Host "  http://127.0.0.1:$($env:PORT)/health"
Write-Host " =====================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Working directory: $(Get-Location)"
python -c "import pathlib; p = pathlib.Path('main.py').resolve(); print(' main.py here:', p, 'OK' if p.is_file() else 'MISSING')"
python -c "import importlib, pathlib; m = importlib.import_module('main'); print(' import main:', pathlib.Path(m.__file__).resolve())"
Write-Host ""
$env:UVICORN_PORT = $env:PORT
python -m uvicorn main:app --host 127.0.0.1 --port $env:PORT --reload
