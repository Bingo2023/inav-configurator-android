#!/usr/bin/env bash
# Upstream-Update: ./scripts/update-upstream.sh <tag-oder-commit>
# Beispiele: ./scripts/update-upstream.sh 9.1.0
#            ./scripts/update-upstream.sh 19ba259   (INAV taggt nicht immer!)
set -euo pipefail

REF="${1:?Usage: $0 <upstream-tag-oder-commit>}"
cd "$(dirname "$0")/.."

OLD_REF=$(git -C inav-configurator rev-parse HEAD)

echo "==> Hole Upstream-Stände..."
git -C inav-configurator fetch --tags origin

echo "==> Checke $REF aus (vorher: ${OLD_REF:0:9})..."
git -C inav-configurator checkout "$REF"

echo "==> Installiere Upstream-Dependencies..."
(cd inav-configurator && (npm ci 2>/dev/null || npm install))

echo ""
echo "==> [PRÜFPUNKT 1] Änderungen an der Preload-Brücke & Serial-Schicht"
echo "    (bei Treffern: shim/electron-api.js nachziehen!)"
if git -C inav-configurator diff --quiet "$OLD_REF" HEAD -- js/main/preload.js js/main/serial.js js/port_handler.js; then
  echo "    Keine Änderungen — Brücke bleibt kompatibel."
else
  git -C inav-configurator diff "$OLD_REF" HEAD -- js/main/preload.js js/main/serial.js js/port_handler.js | sed 's/^/    /'
fi

echo ""
echo "==> [PRÜFPUNKT 2] Neue Node-/Electron-Imports im Renderer (ggf. Alias/Shim ergänzen):"
grep -rn --include='*.js' --include='*.mjs' \
  -e "from 'serialport'" -e "require('serialport')" \
  -e "from 'electron'" -e "require('electron')" \
  inav-configurator/js inav-configurator/tabs 2>/dev/null \
  | grep -v "js/main/" | sed 's/^/    /' || echo "    (keine Treffer außerhalb von js/main/ — gut)"

echo ""
echo "==> [PRÜFPUNKT 2b] electronAPI-Aufrufe im Renderer, die der Shim nicht kennt:"
USED=$(grep -rhoE "electronAPI\.[a-zA-Z]+" inav-configurator/js inav-configurator/tabs --include='*.js' \
  | grep -v "^inav-configurator/js/main/" | sed 's/electronAPI\.//' | sort -u)
MISSING=""
for fn in $USED; do
  grep -qE "(^|[^a-zA-Z])$fn *:" shim/electron-api.js || MISSING="$MISSING $fn"
done
if [ -z "$MISSING" ]; then echo "    (alle abgedeckt)"; else echo "   $MISSING"
  echo "    (bleScan/deviceSelected/dgramCreateSocket sind bekannt und unkritisch)"; fi

echo ""
echo "==> [PRÜFPUNKT 3] Mobile-Build (auf '[upstream-patches] ... nicht gefunden'-Warnungen achten!)"
npm run build:mobile
npx cap sync android

echo ""
echo "==> Fertig. Nächste Schritte:"
echo "    1. APK bauen & auf dem Gerät testen: cd android && ./gradlew assembleDebug"
echo "    2. Version in package.json setzen (versionName der APK folgt automatisch)"
echo "       und versionCode in android/app/build.gradle erhöhen"
echo "    3. Submodule-Pin committen: git add inav-configurator && git commit -m 'chore: bump upstream to $REF'"
