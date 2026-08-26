# deploy-prod.ps1 -- build, push, migrate, deploy the :prod image.
#
# Run manually once you've verified staging (no CI/CD by design -- see
# README.md). Asks for confirmation before touching the prod service.
#
# Usage: .\deploy-prod.ps1  [-Yes]   (-Yes skips the confirmation prompt)

param([switch]$Yes)

$ErrorActionPreference = "Stop"

if (-not $Yes) {
    $answer = Read-Host "This will deploy to PROD. Type 'yes' to continue"
    if ($answer -ne "yes") {
        Write-Host "Aborted." -ForegroundColor Yellow
        exit 1
    }
}

& (Join-Path $PSScriptRoot "_deploy-env.ps1") -Env "prod"
