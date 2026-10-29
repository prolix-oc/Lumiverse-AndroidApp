#!/usr/bin/env bash
# GNU/glibc addon for Termux grun/PRoot. The APK uses build-lancedb-android-native.ts.
set -euo pipefail
root="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
exec bun --no-env-file "$root/scripts/build-lancedb-termux-native.ts" "$@"
