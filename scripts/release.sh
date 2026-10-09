#!/usr/bin/env bash
#
# Cuts a release: builds the signed bundle, publishes the disk image to GitLab
# and prints the cask stanza that the Homebrew tap needs.
#
#   GITLAB_TOKEN=glpat-... ./scripts/release.sh
#   ./scripts/release.sh --dry-run     # everything except publishing
#
# The token needs the `api` scope and comes from
# GitLab → Settings → Access Tokens. An SSH key is not enough: it authenticates
# git, not the REST API, which is what creates releases. Nothing else is
# required; there is no Apple Developer ID involved, see README.
set -euo pipefail

cd "$(dirname "$0")/.."

DRY_RUN=false
[ "${1:-}" = "--dry-run" ] && DRY_RUN=true

# A non-interactive shell (a hook, CI, another script) does not read the shell
# profile that normally puts cargo on the PATH.
command -v cargo >/dev/null || PATH="${HOME}/.cargo/bin:${PATH}"
command -v cargo >/dev/null || { echo "cargo not found; install Rust first"; exit 1; }

PROJECT="palo.kunovsky%2Fflash-stats"   # URL-encoded path, as the API wants it
API="https://gitlab.com/api/v4/projects/${PROJECT}"

step() { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }


# Two ways to reach the API, and only one of them is usually set up. `glab`
# keeps its credentials in the system keyring and refreshes OAuth tokens itself,
# so when it is logged in it is the one that works — note that `glab auth token`
# cannot be used to extract a token for curl, it prints a notice instead. A
# personal access token in GITLAB_TOKEN is the fallback.
#
# Either way this is settled before anything is built, tagged or pushed: an SSH
# key authenticates git but not the API, so a half-authenticated run used to get
# as far as pushing a tag and then fail on the first upload, leaving a tag
# behind for a release that never happened.
TRANSPORT=none
if [ "${DRY_RUN}" = false ]; then
  step "Checking credentials"
  if command -v glab >/dev/null && glab api "projects/${PROJECT}" >/dev/null 2>&1; then
    TRANSPORT=glab
    echo "using glab ($(glab auth status 2>&1 | grep -o 'as [^ ]*' | head -1))"
  elif [ -n "${GITLAB_TOKEN:-}" ] && curl --fail --silent --output /dev/null \
      --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" "${API}"; then
    TRANSPORT=curl
    echo "using GITLAB_TOKEN"
  else
    echo "no working credentials." >&2
    echo "  run 'glab auth login --web', or set GITLAB_TOKEN to a token with the 'api' scope." >&2
    echo "  '--dry-run' builds and checksums without publishing anything." >&2
    exit 1
  fi
fi

# The body of a request is passed as a file in both transports, so the two
# calls below read the same way whichever one is in use.
api_put_file() { # <endpoint> <file>
  case "${TRANSPORT}" in
    glab) glab api --silent --method PUT --input "$2" "$1" ;;
    curl) curl --fail --silent --show-error --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
            --upload-file "$2" "https://gitlab.com/api/v4/$1" > /dev/null ;;
  esac
}

# Releases are their own command in glab, which is just as well: `glab api`
# sends a body without a JSON content type and GitLab answers 415.
api_create_release() { # <tag> <name> <notes> <assets-links-json>
  case "${TRANSPORT}" in
    glab)
      glab release create "$1" --name "$2" --notes "$3" --assets-links "$4" > /dev/null
      ;;
    curl)
      local payload
      payload="$(mktemp)"
      cat > "${payload}" <<JSON
{"name": $(printf '%s' "$2" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),
 "tag_name": "$1",
 "description": $(printf '%s' "$3" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))'),
 "assets": {"links": $4}}
JSON
      curl --fail --silent --show-error --request POST \
        --header "PRIVATE-TOKEN: ${GITLAB_TOKEN}" \
        --header "Content-Type: application/json" \
        --data @"${payload}" "https://gitlab.com/api/v4/projects/${PROJECT}/releases" > /dev/null
      rm -f "${payload}"
      ;;
  esac
}

# One place, and it is the crate: `version` is deliberately absent from
# tauri.conf.json and package.json, so Tauri falls back to Cargo.toml — the
# same number `env!("CARGO_PKG_VERSION")` bakes into the binary and the app
# shows in its About pane. 0.1.1 shipped saying it was 0.1.0 because those two
# were separate fields and one was forgotten.
VERSION="$(grep -m1 '^version = ' src-tauri/Cargo.toml | cut -d'"' -f2)"
[ -n "${VERSION}" ] || { echo "no version in src-tauri/Cargo.toml"; exit 1; }

TAG="v${VERSION}"
# A stable, predictable file name. Tauri's own has a space and an underscore in
# it, which makes for ugly URLs and a cask that has to escape them.
ASSET="flash-stats-${VERSION}-aarch64.dmg"


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
echo "signature verifies (ad-hoc, so not notarised: installing needs brew or xattr)"

step "Preparing ${ASSET}"
cp "${DMG}" "${BUNDLE}/dmg/${ASSET}"
DMG="${BUNDLE}/dmg/${ASSET}"
SHA="$(shasum -a 256 "${DMG}" | cut -d' ' -f1)"
SIZE="$(du -h "${DMG}" | cut -f1 | tr -d ' ')"
echo "${ASSET}  ${SIZE}  ${SHA}"

if [ "${DRY_RUN}" = true ]; then
  cat <<DRY

$(printf '\033[1;33m==>\033[0m') Dry run — nothing was published

  Would tag        ${TAG}
  Would upload     ${API}/packages/generic/flash-stats/${VERSION}/${ASSET}
  Would release    ${TAG}
  Download URL     https://gitlab.com/palo.kunovsky/flash-stats/-/releases/${TAG}/downloads/${ASSET}

  Cask values:
      version "${VERSION}"
      sha256 "${SHA}"

Run without --dry-run, with GITLAB_TOKEN set, to publish.
DRY
  exit 0
fi

step "Tagging"
if git rev-parse "${TAG}" >/dev/null 2>&1; then
  echo "tag ${TAG} already exists locally, reusing it"
else
  git tag -a "${TAG}" -m "Flash Stats ${VERSION}"
fi
git push origin "${TAG}"

step "Publishing"
# Order matters and neither half is obvious:
#
# `glab api --method PUT --input` handles a few kilobytes and then fails a
# 2 MB one with "tls: bad record MAC", so the upload goes through
# `glab release upload`, which needs the release to exist first.
#
# That command then names the asset path after the file, version and all,
# which breaks the whole point of the permalink. So the link it creates is
# swapped for one whose `direct_asset_path` carries no version, leaving
#   /-/releases/permalink/latest/downloads/flash-stats-aarch64.dmg
# valid forever.
# The notes are the changelog entry for this version, so the release page and
# CHANGELOG.md cannot drift apart. A missing entry stops the release: writing
# it afterwards never happens.
CHANGES="$(python3 - "${VERSION}" <<'EXTRACT'
import re, sys
version = sys.argv[1]
text = open("CHANGELOG.md").read()
match = re.search(r"^## %s\b.*?$(.*?)(?=^## |\Z)" % re.escape(version),
                  text, re.S | re.M)
print((match.group(1).strip() if match else ""))
EXTRACT
)"
[ -n "${CHANGES}" ] || { echo "CHANGELOG.md has no '## ${VERSION}' section"; exit 1; }

# Installing: Homebrew first, because it is the only route that leaves nothing
# to repair. The app is ad-hoc signed and not notarised — macOS 15 removed the
# right-click bypass and does not reliably offer "Open Anyway" — so the disk
# image needs the quarantine flag removed by hand.
NOTES="Apple Silicon build, ${SIZE} download.

\`\`\`sh
brew tap palo.kunovsky/flash-stats https://gitlab.com/palo.kunovsky/homebrew-flash-stats.git
brew trust palo.kunovsky/flash-stats
brew install --cask --no-quarantine flash-stats
\`\`\`

Downloading the disk image instead? macOS will refuse to open the app, because
there is no Apple Developer ID behind it to notarise the build. Remove the
quarantine flag after dragging it to Applications:

\`\`\`sh
xattr -d com.apple.quarantine \"/Applications/Flash Stats.app\"
\`\`\`

${CHANGES}"

glab release create "${TAG}" --name "Flash Stats ${VERSION}" --notes "${NOTES}" > /dev/null
glab release upload "${TAG}" "${DMG}" --use-package-registry --package-name flash-stats > /dev/null

LINKS_JSON="$(glab api "projects/${PROJECT}/releases/${TAG}/assets/links")"
OLD_ID="$(printf '%s' "${LINKS_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["id"])')"
ASSET_URL="$(printf '%s' "${LINKS_JSON}" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0]["url"])')"
glab api --method DELETE "projects/${PROJECT}/releases/${TAG}/assets/links/${OLD_ID}" > /dev/null
glab api --method POST "projects/${PROJECT}/releases/${TAG}/assets/links" \
  -f "name=flash-stats-aarch64.dmg (${SIZE})" \
  -f "url=${ASSET_URL}" \
  -f "direct_asset_path=/flash-stats-aarch64.dmg" \
  -f "link_type=package" > /dev/null

step "Checking the published link"
PERMALINK="https://gitlab.com/palo.kunovsky/flash-stats/-/releases/permalink/latest/downloads/flash-stats-aarch64.dmg"
CODE="$(curl -s -o /dev/null -w '%{http_code}' -L "${PERMALINK}")"
[ "${CODE}" = "200" ] || { echo "the permalink answers ${CODE}, not 200" >&2; exit 1; }
echo "200"
echo "released"

cat <<SUMMARY

$(printf '\033[1;32m==>\033[0m') Done — ${TAG}

  This release   https://gitlab.com/palo.kunovsky/flash-stats/-/releases/${TAG}/downloads/flash-stats-aarch64.dmg
  Always latest  ${PERMALINK}
  Size           ${SIZE}

Update the tap (Casks/flash-stats.rb):

  version "${VERSION}"
  sha256 "${SHA}"

SUMMARY
