# Reads ../../app.config.json -- the single source of truth also used by
# infra/scripts/deploy-*.ps1|.sh -- so there is nothing product-specific to
# set as a separate .tfvars file.
locals {
  config = jsondecode(file("${path.module}/../../app.config.json"))

  product_name   = local.config.product_name
  region         = local.config.aws_region
  container_port = local.config.container_port

  domain_root       = try(local.config.domain.root, "")
  staging_subdomain = try(local.config.domain.staging_subdomain, "staging")

  shared = local.config.shared_infra

  envs = ["staging", "prod"]

  # On Windows, a bare "bash" on PATH resolves to the WSL launcher shim
  # (C:\Windows\System32\bash.exe) ahead of Git Bash, which fails unless a
  # WSL distro is installed. Point straight at Git Bash if it's present at
  # its default install path; elsewhere (macOS/Linux) "bash" on PATH is fine.
  bash_path = fileexists("C:/Program Files/Git/bin/bash.exe") ? "C:/Program Files/Git/bin/bash.exe" : "bash"

  # Placeholder https://*.invalid URL (RFC 2606 -- guaranteed to never
  # resolve) until domain_root is set, so Cognito's callback/logout URLs are
  # always valid without requiring a real domain up front.
  app_public_url = {
    for env in local.envs :
    env => (
      local.domain_root != "" ?
      (env == "staging" ?
        "https://${local.staging_subdomain}.${local.domain_root}" :
        "https://${local.domain_root}") :
      "https://${env}.${local.product_name}.invalid"
    )
  }
}

check "product_name_is_set" {
  assert {
    condition     = local.product_name != "webapp-template"
    error_message = "app.config.json still has the placeholder product_name 'webapp-template' -- edit it to your app's name first."
  }
}
