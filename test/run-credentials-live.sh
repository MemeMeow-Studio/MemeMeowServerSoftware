#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .local/credentials-temp
export TMPDIR="$PWD/.local/credentials-temp"
export TMP="$TMPDIR"
export TEMP="$TMPDIR"
if [[ "${1:-electron}" == "android" ]]; then
  exec node test/android-credentials-live.cjs
fi
exec xvfb-run -a dbus-run-session -- node test/credentials-live.cjs
