#!/usr/bin/env bash
# Einmaliges Setup nach dem Entpacken: Submodule holen, Remote setzen, pushen.
# Usage: ./scripts/bootstrap.sh <github-user-oder-org> [upstream-tag]
set -euo pipefail

OWNER="${1:?Usage: $0 <github-user-oder-org> [upstream-tag]}"
TAG="${2:-9.0.2}"
REPO="inav-configurator-android"

cd "$(dirname "$0")/.."

echo "==> Upstream als Submodule einbinden (Tag $TAG)..."
if [ ! -d inav-configurator/.git ]; then
  git submodule add https://github.com/iNavFlight/inav-configurator.git inav-configurator
fi
git -C inav-configurator fetch --tags origin
git -C inav-configurator checkout "$TAG"
git add .gitmodules inav-configurator
git commit -m "chore: pin upstream inav-configurator to $TAG" || true

echo "==> Remote setzen und pushen..."
echo "    (Repo vorher auf https://github.com/new anlegen: Name '$REPO', OHNE README/Lizenz-Init)"
git remote add origin "git@github.com:$OWNER/$REPO.git" 2>/dev/null || \
  git remote set-url origin "git@github.com:$OWNER/$REPO.git"
git branch -M main
git push -u origin main

echo "==> Fertig: https://github.com/$OWNER/$REPO"
