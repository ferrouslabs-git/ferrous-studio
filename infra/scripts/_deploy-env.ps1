# _deploy-env.ps1 -- shared implementation for deploy-staging.ps1 / deploy-prod.ps1.
# Not meant to be run directly.
param([Parameter(Mandatory)][ValidateSet("staging", "prod")][string]$Env)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$TerraformDir = Join-Path $RepoRoot "infra\terraform"
$Config = Get-Content (Join-Path $RepoRoot "app.config.json") | ConvertFrom-Json
$Product = $Config.product_name
$Region = $Config.aws_region
$Shared = $Config.shared_infra
$identity = aws sts get-caller-identity --output json | ConvertFrom-Json
$AccountId = $identity.Account

Write-Host "== Deploying '$Product' to $Env ($Region) ==" -ForegroundColor Cyan

# ── Pull what `terraform apply` created (infra/terraform) ──
Push-Location $TerraformDir
$tfOut = terraform output -json | ConvertFrom-Json
Pop-Location
if (-not $tfOut) {
    throw "No Terraform outputs found -- run 'terraform apply' in infra/terraform first (see README.md)."
}
$sgId = $tfOut.security_group_id.value
$tgArn = $tfOut.target_group_arns.value.$Env
$taskRoleArn = $tfOut.task_role_arn.value
$repoUri = $tfOut.ecr_repository_url.value
$appPublicUrl = $tfOut.app_public_url.value.$Env
$cognito = $tfOut.cognito.value.$Env
$documentsBucket = $tfOut.documents_bucket.value.$Env
$poolId = $cognito.user_pool_id
$clientId = $cognito.client_id
$cognitoDomain = $cognito.domain

# ── 1. Build + push image ──
Write-Host "`n[1/5] Build + push :$Env image" -ForegroundColor Cyan
# The pipe is delegated to cmd.exe on purpose. Piping one native executable
# into another inside Windows PowerShell 5.1 round-trips the bytes through
# PowerShell's own encoding, which corrupts the ECR token and makes
# `docker login` fail with a misleading "400 Bad Request" -- the credential is
# fine, the pipe is not. cmd.exe passes the bytes through untouched, and the
# same command works unchanged under bash (see _deploy-env.sh).
$ecrRegistry = "$AccountId.dkr.ecr.$Region.amazonaws.com"
cmd /c "aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $ecrRegistry"
if ($LASTEXITCODE -ne 0) { throw "docker login to $ecrRegistry failed" }
Push-Location $RepoRoot
docker build -t "${Product}:$Env" `
    --build-arg VITE_COGNITO_DOMAIN=$cognitoDomain `
    --build-arg VITE_COGNITO_APP_CLIENT_ID=$clientId `
    .
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "docker build failed" }
docker tag "${Product}:$Env" "${repoUri}:$Env"
docker push "${repoUri}:$Env"
Pop-Location

# ── 2. Render + register task definition ──
Write-Host "`n[2/5] Register task definition" -ForegroundColor Cyan
$template = Get-Content (Join-Path $RepoRoot "infra\ecs\taskdef.template.json") -Raw
$rendered = $template `
    -replace "{{PRODUCT_NAME}}", $Product `
    -replace "{{ENV}}", $Env `
    -replace "{{CONTAINER_PORT}}", $Config.container_port `
    -replace "{{IMAGE}}", "${repoUri}:$Env" `
    -replace "{{EXECUTION_ROLE_ARN}}", $Shared.ecs_execution_role_arn `
    -replace "{{TASK_ROLE_ARN}}", $taskRoleArn `
    -replace "{{AWS_REGION}}", $Region `
    -replace "{{ACCOUNT_ID}}", $AccountId `
    -replace "{{COGNITO_USER_POOL_ID}}", $poolId `
    -replace "{{COGNITO_CLIENT_ID}}", $clientId `
    -replace "{{COGNITO_DOMAIN}}", $cognitoDomain `
    -replace "{{APP_PUBLIC_URL}}", $appPublicUrl `
    -replace "{{SES_SENDER_EMAIL}}", $Config.email.sender `
    -replace "{{EMAIL_FROM_NAME}}", $Config.email.from_name `
    -replace "{{EMAIL_LEGAL}}", $Config.email.legal `
    -replace "{{DOCUMENTS_BUCKET}}", $documentsBucket `
    -replace "{{PLATFORM_ADMIN_EMAILS}}", $Config.platform_admin_emails
$genDir = Join-Path $RepoRoot "infra\ecs\generated"
New-Item -ItemType Directory -Force -Path $genDir | Out-Null
$renderedPath = Join-Path $genDir "$Product-$Env.taskdef.json"
Set-Content -Path $renderedPath -Value $rendered
aws ecs register-task-definition --region $Region --cli-input-json "file://$renderedPath" | Out-Null
Write-Host "  registered $Product-$Env" -ForegroundColor Green

# ── 3. Run migrations once ──
Write-Host "`n[3/5] Run Alembic migrations" -ForegroundColor Cyan
$subnetsCsv = ($Shared.subnets -join ",")
$netConfig = "awsvpcConfiguration={subnets=[$subnetsCsv],securityGroups=[$sgId],assignPublicIp=ENABLED}"
$overrides = @{ containerOverrides = @(@{ name = $Product; command = @("sh", "-c", "cd /workspace/backend && alembic upgrade head") }) } | ConvertTo-Json -Depth 10
# Written to a temp file + passed as file://... -- passing JSON with embedded
# quotes directly as a CLI argument gets mangled by native-exe argv
# reconstruction on Windows (PowerShell -> aws.exe via the C runtime).
$overridesFile = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($overridesFile, $overrides, [Text.UTF8Encoding]::new($false))
$taskArn = aws ecs run-task --region $Region --cluster $Shared.ecs_cluster --launch-type FARGATE `
    --network-configuration $netConfig --task-definition "$Product-$Env" --overrides "file://$overridesFile" `
    --query "tasks[0].taskArn" --output text
Remove-Item $overridesFile -ErrorAction SilentlyContinue
Write-Host "  migration task $taskArn running..." -NoNewline
aws ecs wait tasks-stopped --region $Region --cluster $Shared.ecs_cluster --tasks $taskArn
$exitCode = aws ecs describe-tasks --region $Region --cluster $Shared.ecs_cluster --tasks $taskArn --query "tasks[0].containers[0].exitCode" --output text
if ($exitCode -ne "0") {
    Write-Host " FAILED (exit $exitCode) -- see CloudWatch /ecs/$Product-$Env" -ForegroundColor Red
    throw "migration failed"
}
Write-Host " ok" -ForegroundColor Green

# ── 4. Create or update the service ──
Write-Host "`n[4/5] ECS service" -ForegroundColor Cyan
$serviceName = "$Product-$Env"
$existing = aws ecs describe-services --region $Region --cluster $Shared.ecs_cluster --services $serviceName --query "services[?status=='ACTIVE'] | [0]" --output json | ConvertFrom-Json
if ($existing) {
    aws ecs update-service --region $Region --cluster $Shared.ecs_cluster --service $serviceName `
        --task-definition "$Product-$Env" --force-new-deployment | Out-Null
    Write-Host "  updated existing service (forced new deployment)" -ForegroundColor Green
} else {
    aws ecs create-service --region $Region --cluster $Shared.ecs_cluster `
        --service-name $serviceName --task-definition "$Product-$Env" `
        --desired-count 1 --launch-type FARGATE `
        --network-configuration $netConfig `
        --load-balancers "targetGroupArn=$tgArn,containerName=$Product,containerPort=$($Config.container_port)" `
        --health-check-grace-period-seconds 60 | Out-Null
    Write-Host "  created new service" -ForegroundColor Green
}

# ── 5. Wait for the new deployment to roll out ──
#
# Waits on the SERVICE's primary deployment, not on target health. Target
# health answers "is something healthy behind this target group", and during a
# rolling deploy that something is the OLD task -- which is still serving,
# still healthy, and still running the previous image. Polling it reported
# "deploy succeeded" while the new task was pending, so the very next request
# hit the old code and made the deploy look like it had silently done nothing.
# rolloutState is the only signal that means what this step claims.
Write-Host "`n[5/5] Waiting for the new deployment to roll out..." -ForegroundColor Cyan
$rolledOut = $false
for ($i = 0; $i -lt 60; $i++) {
    $prevPref = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $state = aws ecs describe-services --region $Region --cluster $Shared.ecs_cluster --services $serviceName `
        --query "services[0].deployments[?status=='PRIMARY'].rolloutState | [0]" --output text 2>$null
    $ErrorActionPreference = $prevPref
    if ($state -eq "COMPLETED") { $rolledOut = $true; break }
    if ($state -eq "FAILED") {
        throw "ECS rollout FAILED -- see CloudWatch /ecs/$Product-$Env and 'aws ecs describe-services --cluster $($Shared.ecs_cluster) --services $serviceName'"
    }
    Start-Sleep -Seconds 10
}
if ($rolledOut) {
    Write-Host "`n== $Env deploy succeeded -- new task definition is live ==" -ForegroundColor Green
} else {
    Write-Host "`n== $Env deploy: rollout still in progress after 10 min -- check 'aws ecs describe-services --cluster $($Shared.ecs_cluster) --services $serviceName' and CloudWatch /ecs/$Product-$Env ==" -ForegroundColor Yellow
}
