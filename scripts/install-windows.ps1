param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'This installer is for Windows.' }
$longviewRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$longviewBin = Join-Path $env:USERPROFILE '.local/bin'
$longviewSource = Join-Path $longviewRoot 'target/release/longview.exe'
$longviewDestination = Join-Path $longviewBin 'lv.exe'

Push-Location $longviewRoot
try {
    if (-not $SkipBuild) {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
        & cargo build --release --locked -p longview --features custom-protocol
        if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
    }
    if (-not (Test-Path -LiteralPath $longviewSource -PathType Leaf)) { throw "Build missing: $longviewSource" }
    New-Item -ItemType Directory -Path $longviewBin -Force | Out-Null
    Copy-Item -LiteralPath $longviewSource -Destination $longviewDestination -Force

    $longviewUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $longviewPathEntries = @($longviewUserPath -split ';' | Where-Object { $_ })
    if (-not ($longviewPathEntries | Where-Object { $_.TrimEnd('\','/') -ieq $longviewBin.TrimEnd('\','/') })) {
        [Environment]::SetEnvironmentVariable('Path', (($longviewPathEntries + $longviewBin) -join ';'), 'User')
    }
    if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\','/') -ieq $longviewBin.TrimEnd('\','/') })) {
        $env:Path += ";$longviewBin"
    }
    Write-Output "Installed: $longviewDestination"
    Write-Output 'Run lv, lv <file.md>, or lv <folder>. Open a new terminal if lv is not yet found.'
} finally { Pop-Location }
