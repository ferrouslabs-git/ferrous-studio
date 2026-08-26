# deploy-staging.ps1 -- build, push, migrate, deploy the :staging image.
#
# Run manually from the `staging` branch (no CI/CD by design -- see README.md).
# Requires terraform apply in infra/terraform to have run at least once.
#
# Usage: .\deploy-staging.ps1

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
& (Join-Path $PSScriptRoot "_deploy-env.ps1") -Env "staging"
