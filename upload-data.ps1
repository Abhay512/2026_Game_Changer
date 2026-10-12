# Upload the data archives to a GitHub release (resumable: parts already on GitHub are skipped).
#
#   .\upload-data.ps1                                  # upload release_parts\* to the current data release
#   .\upload-data.ps1 -DryRun                          # only show what would be uploaded
#   .\upload-data.ps1 -Pack -Tag data-2026-11-01       # after new data: rebuild the parts, then upload to a new release
#
# Run it again after any failure (e.g. the internet dropped): it continues where it stopped.
# The server picks the data up when DATA_RELEASE is set to the same tag.
param(
    [string]$Tag = "data-2026-10-12",
    [string]$Repo = "",
    [switch]$Pack,
    [switch]$DryRun,
    [int]$Retries = 10
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$parts = Join-Path $root "release_parts"
if (-not $Repo) { $Repo = (gh repo view --json nameWithOwner --jq .nameWithOwner) }

if ($Pack) {
    Push-Location (Join-Path $root "backend")
    try {
        $size = 200MB  # small parts: a dropped connection only repeats one part
        python -m tools.data_release pack-store --out $parts --part-size $size
        if ($LASTEXITCODE -ne 0) { throw "pack-store failed" }
        python -m tools.data_release pack-raw --out $parts --part-size $size
        if ($LASTEXITCODE -ne 0) { throw "pack-raw failed" }
    } finally { Pop-Location }
}

$files = @(Get-ChildItem $parts -File | Where-Object { $_.Name -match '^(store\.tar|raw\.tar\.gz)\.part\d{3}$' } |
           Sort-Object @{ Expression = { -not $_.Name.StartsWith("store") } }, Name)  # store first: the server needs it
if (-not $files) { throw "No parts in $parts. Run with -Pack first." }

gh release view $Tag --repo $Repo *> $null
if ($LASTEXITCODE -ne 0) {
    if ($DryRun) { Write-Host "release $Tag does not exist yet (would be created)" }
    else {
        gh release create $Tag --repo $Repo --target main --title "Data $Tag" `
            --notes "Built store (store.tar.part*) and source CSVs (raw.tar.gz.part*), split into parts. The server downloads the store when DATA_RELEASE=$Tag."
        if ($LASTEXITCODE -ne 0) { throw "could not create release $Tag" }
    }
}

function Get-Uploaded {
    $json = gh release view $Tag --repo $Repo --json assets 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) { return @{} }
    $map = @{}
    foreach ($a in ($json | ConvertFrom-Json).assets) { if ($a.state -eq "uploaded") { $map[$a.name] = [long]$a.size } }
    return $map
}

$done = Get-Uploaded
$todo = @($files | Where-Object { -not ($done.ContainsKey($_.Name) -and $done[$_.Name] -eq $_.Length) })
Write-Host ("{0} parts, {1} already on GitHub, {2} to upload ({3:N0} MB)" -f $files.Count, ($files.Count - $todo.Count), $todo.Count, (($todo | Measure-Object Length -Sum).Sum / 1MB))
if ($DryRun) { $todo | ForEach-Object { Write-Host "  would upload $($_.Name)" }; exit 0 }

foreach ($f in $todo) {
    for ($attempt = 1; $attempt -le $Retries; $attempt++) {
        $t = Get-Date
        gh release upload $Tag $f.FullName --repo $Repo --clobber 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host ("OK    {0}  ({1:N0}s, attempt {2})" -f $f.Name, ((Get-Date) - $t).TotalSeconds, $attempt)
            break
        }
        Write-Host ("FAIL  {0}  attempt {1} of {2}; retrying in 30s" -f $f.Name, $attempt, $Retries)
        Start-Sleep -Seconds 30
    }
}

$done = Get-Uploaded
$missing = @($files | Where-Object { -not ($done.ContainsKey($_.Name) -and $done[$_.Name] -eq $_.Length) })
if ($missing) {
    Write-Host "Still missing: $($missing.Name -join ', '). Run .\upload-data.ps1 again when the connection is stable."
    exit 1
}
Write-Host "All $($files.Count) parts are on GitHub (release $Tag)."
