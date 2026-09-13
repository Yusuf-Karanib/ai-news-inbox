$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $packageRoot

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
    throw 'Node.js 20 or newer is required.'
}

$nodeMajor = [int]((& node.exe --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) {
    throw 'Node.js 20 or newer is required.'
}

$supabaseCli = Join-Path $packageRoot 'node_modules\supabase\dist\supabase.js'
$minimumCliVersion = [version]'2.117.0'
$installedCliVersion = $null
if (Test-Path -LiteralPath $supabaseCli) {
    try { $installedCliVersion = [version]((& node.exe $supabaseCli --version).Trim()) } catch { }
}
if ($null -eq $installedCliVersion -or $installedCliVersion -lt $minimumCliVersion) {
    Write-Host 'Installing a current Supabase setup tool in this folder...'
    & npm.cmd install supabase@latest --save-dev
    if ($LASTEXITCODE -ne 0) { throw 'Supabase tool installation failed.' }
}

$projectRef = (Read-Host 'Paste your Supabase project reference').Trim()
if ($projectRef -notmatch '^[a-z0-9]{10,40}$') {
    throw 'That project reference does not look valid.'
}

Write-Host 'Checking your saved Supabase sign-in...'
& node.exe $supabaseCli link --project-ref $projectRef
if ($LASTEXITCODE -ne 0) {
    Write-Host 'No working saved sign-in was found. Sign in when the browser opens.'
    & node.exe $supabaseCli login
    if ($LASTEXITCODE -ne 0) { throw 'Supabase sign-in failed.' }

    & node.exe $supabaseCli link --project-ref $projectRef
    if ($LASTEXITCODE -ne 0) { throw 'Linking the Supabase project failed.' }
}

& node.exe $supabaseCli db push
if ($LASTEXITCODE -ne 0) { throw 'The database migration failed.' }

& node.exe $supabaseCli functions deploy daily-news --project-ref $projectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Deploying daily-news failed.' }

& node.exe $supabaseCli functions deploy telegram-feedback --project-ref $projectRef --use-api --no-verify-jwt
if ($LASTEXITCODE -ne 0) { throw 'Deploying telegram-feedback failed.' }

Write-Host 'Deployment finished. Existing twice-daily schedules remain active. The older schedule upgrade runs only when needed and when its saved Vault values are found. New installations continue at step 4 in SETUP.md.'
