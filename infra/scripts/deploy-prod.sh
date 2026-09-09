#!/usr/bin/env bash
# deploy-prod.sh — build, push, migrate, deploy the :prod image.
# Run manually once you've verified staging (no CI/CD by design — see README.md).
# Usage: ./deploy-prod.sh [-y]   (-y skips the confirmation prompt)
set -euo pipefail

if [ "${1:-}" != "-y" ]; then
  read -r -p "This will deploy to PROD. Type 'yes' to continue: " answer
  if [ "$answer" != "yes" ]; then
    echo "Aborted."
    exit 1
  fi
fi

exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_deploy-env.sh" prod
