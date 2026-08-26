# create-local-dev-user.ps1 -- seed one Cognito user in the STAGING pool so a
# fresh clone has a real login to start with (there is no local Cognito).
#
# Usage: .\create-local-dev-user.ps1 -Email dev@example.com -Password 'Someth1ng!'

param(
    [Parameter(Mandatory)][string]$Email,
    [Parameter(Mandatory)][string]$Password
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$Config = Get-Content (Join-Path $RepoRoot "app.config.json") | ConvertFrom-Json
$Region = $Config.aws_region

Push-Location (Join-Path $RepoRoot "infra\terraform")
$tfOut = terraform output -json | ConvertFrom-Json
Pop-Location
$poolId = $tfOut.cognito.value.staging.user_pool_id
if (-not $poolId) { throw "Could not find the staging Cognito pool -- run 'terraform apply' in infra/terraform first." }

aws cognito-idp admin-create-user --region $Region --user-pool-id $poolId --username $Email `
    --user-attributes Name=email,Value=$Email Name=email_verified,Value=true --message-action SUPPRESS | Out-Null
aws cognito-idp admin-set-user-password --region $Region --user-pool-id $poolId --username $Email `
    --password $Password --permanent | Out-Null

Write-Host "Created $Email in the staging pool ($poolId). Sign in with it locally." -ForegroundColor Green
