#!/usr/bin/env bash
#
# Cuts a release: builds the signed bundle, publishes the disk image to GitLab
# and prints the cask stanza that the Homebrew tap needs.
#
#   GITLAB_TOKEN=glpat-... ./scripts/release.sh
#
# The token needs the `api` scope and comes from
# GitLab → Settings → Access Tokens. Nothing else is required; there is no
# Apple Developer ID involved, see README.
set -euo pipefail

cd "$(dirname "$0")/.."

PROJECT="palo.kunovsky%2Fflash-stats"   # URL-encoded path, as the API wants it
API="https://gitlab.com/api/v4/projects/${PROJECT}"

: "${GITLAB_TOKEN:?set GITLAB_TOKEN (GitLab → Settings → Access Tokens, scope: api)}"

VERSION="$(python3 -c "import json;print(json.load(open('src-tauri/tauri.conf.json'))['version'])")"
TAG="v${VERSION}"
# A stable, predictable file name. Tauri's own has a space and an underscore in
# it, which makes for ugly URLs and a cask that has to escape them.
ASSET="flash-stats-${VERSION}-aarch64.dmg"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }

step "Building ${TAG}"
# Ad-hoc signing, applied before the disk image is assembled so the app inside
# it carries the signature. Without this macOS calls the download *damaged*
# rather than merely unverified.
APPLE_SIGNING_IDENTITY=- npm run tauri:build

BUNDLE="src-tauri/target/release/bundle"
APP="${BUNDLE}/macos/Flash Stats.app"
DMG="$(find "${BUNDLE}/dmg" -name '*.dmg' -maxdepth 1 | head -1)"
[ -n "${DMG}" ] || { echo "no disk image was produced"; exit 1; }

step "Checking the signature"
codesign --verify --strict --verbose=1 "${APP}"
echo "signature verifies (ad-hoc: users get one 'Open Anyway', see README)"

step "Preparing ${ASSET}"
cp "${DMG}" "${BUNDLE}/dmg/${ASSET}"
DMG="${BUNDLE}/dmg/${ASSET}"
SHA="$(shasum -a 256 "${DMG}" | cut -d' ' -f1)"
SIZE="$(du -h "${DMG}" | cut -f1 | tr -d ' ')"
echo "${ASSET}  ${SIZE}  ${SHA}"

step "Tagging"
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "tag ${TAG} already exists locally, reusing it"
else
  git tag -a "${TAG}" -m "Flash Stats ${VERSION}"
fi
git push origin "${TAG}"

step "Uploading to the package registry"
# The generic registry is what gives a release asset a stable URL; attaching a
# file to a release directly produces a one-off path that changes every time.
curl --fail --silent --show-error \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  --upload-file "${DMG}" \
  "${API}/packages/generic/flash-stats/${VERSION}/${ASSET}" > /dev/null
echo "uploaded"

step "Creating the release"
# `direct_asset_path` is the point of this call: it is what makes
# /-/releases/vX.Y.Z/downloads/<name> resolve, which is the URL the cask uses.
curl --fail --silent --show-error --request POST \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
  --header "Content-Type: application/json" \
  --data @- "${API}/releases" > /dev/null <<JSON
{
  "name": "Flash Stats ${VERSION}",
  "tag_name": "${TAG}",
  "description": "Apple Silicon build, ${SIZE} download.\n\nFirst launch needs one **Open Anyway** in System Settings → Privacy & Security; see the README for why.",
  "assets": {
    "links": [
      {
        "name": "${ASSET} (${SIZE})",
        "url": "https://gitlab.com/api/v4/projects/${PROJECT}/packages/generic/flash-stats/${VERSION}/${ASSET}",
        "direct_asset_path": "/${ASSET}",
        "link_type": "package"
      }
    ]
  }
}
JSON
echo "released"

cat <<SUMMARY

$(printf '\033[1;32m==>\033[0m') Done — ${TAG}

  Download   https://gitlab.com/palo.kunovsky/flash-stats/-/releases/${TAG}/downloads/${ASSET}
  Size       ${SIZE}

Update the tap (Casks/flash-stats.rb):

  version "${VERSION}"
  sha256 "${SHA}"

SUMMARY
