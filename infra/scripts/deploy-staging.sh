#!/usr/bin/env bash
# deploy-staging.sh — build, push, migrate, deploy the :staging image.
# Run manually from the `staging` branch (no CI/CD by design — see README.md).
set -euo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_deploy-env.sh" staging
