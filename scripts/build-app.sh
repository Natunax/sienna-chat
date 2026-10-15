#!/bin/sh
# Builds Sienna.app. If this Mac has an Apple code signing certificate, the app
# is signed with it, so macOS keeps recognizing every new build as the same
# app (and "Always Allow" for the Keychain sticks). Without one it is built
# unsigned. Set APPLE_SIGNING_IDENTITY yourself to choose a certificate.
set -eu

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  identity=$(security find-identity -v -p codesigning 2>/dev/null \
    | sed -nE 's/.*"((Developer ID Application|Apple Development): [^"]*)".*/\1/p' \
    | head -n 1)
  if [ -n "$identity" ]; then
    export APPLE_SIGNING_IDENTITY="$identity"
    echo "Signing with: $identity"
  else
    echo "No code signing certificate found; building unsigned."
  fi
fi

exec npx tauri build "$@"
