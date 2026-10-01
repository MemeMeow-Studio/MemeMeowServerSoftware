#!/usr/bin/env bash
set -euo pipefail

project_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
state_directory="$project_directory/.local/artifact-sync"
mkdir -p -- "$state_directory"
exec /usr/bin/flock --nonblock --conflict-exit-code 0 "$state_directory/sync.lock" node "$project_directory/scripts/artifact-sync.cjs"
