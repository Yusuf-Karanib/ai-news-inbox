$ErrorActionPreference = 'Stop'

$packageRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $packageRoot

$testFiles = @(Get-ChildItem -LiteralPath (Join-Path $packageRoot 'tests') -Filter '*.test.ts' |
    ForEach-Object { $_.FullName })
& node.exe --experimental-strip-types --test $testFiles
if ($LASTEXITCODE -ne 0) { throw 'Tests failed.' }
