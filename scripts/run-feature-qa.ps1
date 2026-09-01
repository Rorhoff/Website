# Run fast feature QA for MotherWyrm bots + LDBG recent features.
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

Write-Host "=== MotherWyrm unit tests ==="
Push-Location motherwyrm\tv
npm test
Pop-Location

Write-Host ""
Write-Host "=== MotherWyrm WebSocket relay ==="
python -m pytest mw-test/ -v

Write-Host ""
Write-Host "=== LDBG feature QA ==="
Push-Location ldbg
npm run test:feature-qa
Pop-Location

Write-Host ""
Write-Host "All feature QA passed."
