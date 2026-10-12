#!/usr/bin/env bash
# Cuts a Nexus Vikunja release: tests -> build -> manifest bump -> tag -> upload.
# Nexus Suite's Add-ons page installs and updates from the LATEST GitHub
# release and needs main.js and manifest.json attached to it (styles.css too).
#
#   ./release.sh 0.1.0
set -euo pipefail

VERSION="${1:-}"
[ -n "$VERSION" ] || { echo "usage: ./release.sh <version>   e.g. ./release.sh 0.1.0" >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "version must look like x.y.z" >&2; exit 1; }

cd "$(dirname "$0")"

if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty — commit your source changes first:" >&2
  git status --short >&2
  exit 1
fi
if git rev-parse "v$VERSION" >/dev/null 2>&1; then
  echo "tag v$VERSION already exists" >&2
  exit 1
fi

echo "==> tests"
npm test

echo "==> build"
npm run build

echo "==> manifest -> $VERSION"
tmp=$(mktemp)
jq --arg v "$VERSION" '.version = $v' manifest.json > "$tmp" && mv "$tmp" manifest.json
tmp=$(mktemp)
jq --arg v "$VERSION" '.version = $v' package.json > "$tmp" && mv "$tmp" package.json
minapp=$(jq -r '.minAppVersion' manifest.json)
if [ -f versions.json ]; then
  tmp=$(mktemp)
  jq --arg v "$VERSION" --arg m "$minapp" '. + {($v): $m}' versions.json > "$tmp" && mv "$tmp" versions.json
else
  jq -n --arg v "$VERSION" --arg m "$minapp" '{($v): $m}' > versions.json
fi

git add manifest.json package.json versions.json
git diff --cached --quiet || git commit -m "release v$VERSION"
git tag "v$VERSION"
git push origin HEAD --tags

echo "==> uploading assets"
gh release create "v$VERSION" main.js manifest.json styles.css --title "v$VERSION" --generate-notes

echo
echo "done. Nexus Suite → Settings → Add-ons → update picks it up."
