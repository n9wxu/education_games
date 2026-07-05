#!/usr/bin/env bash
#
# Self-update Family Games from the git repo and restart the service.
# Run manually (sudo /opt/education-games/update.sh) or via the daily timer.
#
set -euo pipefail

INSTALL_DIR="${INSTALL_DIR:-$(cd "$(dirname "$0")" && pwd)}"
SERVICE="education-games"

cd "$INSTALL_DIR"

echo "==> Fetching latest from git"
git fetch --all --quiet
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo main)"
before="$(git rev-parse HEAD 2>/dev/null || echo none)"
git reset --hard "origin/$BRANCH" --quiet 2>/dev/null || git pull --ff-only
after="$(git rev-parse HEAD 2>/dev/null || echo none)"

if [[ "$before" == "$after" ]]; then
  echo "==> Already up to date ($after)"
else
  echo "==> Updated $before -> $after"
fi

echo "==> Installing dependencies"
npm install --omit=dev --no-audit --no-fund

if command -v systemctl >/dev/null && systemctl cat "$SERVICE.service" >/dev/null 2>&1; then
  echo "==> Restarting $SERVICE"
  systemctl restart "$SERVICE.service"
  echo "✅ Updated and restarted."
else
  echo "✅ Updated. (No systemd service found — restart your server manually.)"
fi
