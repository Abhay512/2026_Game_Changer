# Stock Analyser - run locally with one command.
#
#   .\run.ps1              build whatever is missing (Python packages, data store, website), then serve
#   .\run.ps1 -Ingest      refresh the data store first (incremental: only changed stocks are rebuilt)
#   .\run.ps1 -Rebuild     rebuild the website first
#   .\run.ps1 -Port 8080   serve on another port
#   .\run.ps1 -NoBrowser   don't open the browser
#
# Stop with Ctrl+C.
param(
    [switch]$Ingest,
    [switch]$Rebuild,
    [int]$Port = 8000,
    [switch]$NoBrowser
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"

Push-Location $backend
try {
    python -c "import fastapi, uvicorn, pandas, pyarrow, scipy" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing Python packages..."
        python -m pip install -r requirements.txt
        if ($LASTEXITCODE -ne 0) { throw "pip install failed" }
    }

    if ($Ingest -or -not (Test-Path (Join-Path $root "store\manifest.json"))) {
        Write-Host "Building the data store (first run takes ~2 minutes for 51 stocks)..."
        python -m ingest
        if ($LASTEXITCODE -ne 0) { throw "ingest failed" }
    }

    if ($Rebuild -or -not (Test-Path (Join-Path $frontend "dist\index.html"))) {
        Write-Host "Building the website..."
        Push-Location $frontend
        try {
            if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund }
            npm run build
            if ($LASTEXITCODE -ne 0) { throw "website build failed" }
        } finally { Pop-Location }
    }

    $env:PORT = "$Port"
    $url = "http://127.0.0.1:$Port/"
    if (-not $NoBrowser) {
        Start-Job -ScriptBlock { param($u) Start-Sleep -Seconds 3; Start-Process $u } -ArgumentList $url | Out-Null
    }
    Write-Host "Stock Analyser on $url  (Ctrl+C to stop)"
    python -m app
} finally {
    Pop-Location
}
