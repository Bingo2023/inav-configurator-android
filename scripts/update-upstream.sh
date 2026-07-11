#!/usr/bin/env bash
# Upstream-Update in einem Schritt: ./scripts/update-upstream.sh <tag>
# Beispiel: ./scripts/update-upstream.sh 9.1.0
set -euo pipefail

TAG="${1:?Usage: $0 <upstream-release-tag>  (z.B. 9.1.0)}"
cd "$(dirname "$0")/.."

echo "==> Hole Tags aus Upstream..."
git -C inav-configurator fetch --tags origin

echo "==> Checke Tag $TAG aus..."
git -C inav-configurator checkout "$TAG"

echo "==> Installiere Upstream-Dependencies..."
(cd inav-configurator && (npm ci 2>/dev/null || npm install))

echo "==> Prüfe auf neue Node-/Electron-Imports im Renderer (ggf. Shims/Aliase ergänzen):"
grep -rn --include='*.js' --include='*.mjs' \
  -e "from 'serialport'" -e 'require("serialport")' -e "require('serialport')" \
  -e "from 'electron'" -e "require('electron')" \
  inav-configurator/js 2>/dev/null | sed 's/^/    /' || echo "    (keine Treffer — gut)"

echo "==> Mobile-Build + Capacitor-Sync..."
npm run build:mobile
npx cap sync android

echo "==> Submodule-Pin committen:"
echo "    git add inav-configurator && git commit -m 'chore: bump upstream to $TAG'"
echo "==> Fertig. Jetzt in Android Studio bauen: npx cap open android"
