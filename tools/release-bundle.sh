#!/usr/bin/env bash
# Builds the release bundle proginone-<version>.tar.gz and its .sha256 from this checkout
# (docs/guides/release.md). Run after `pnpm build` and `pnpm content:build`.
#
# The bundle is the commit's tracked files (git archive) plus the web build, content.db and the
# registry @proginone/* packages under vendor/ (tools/vendor-proginone.mjs), so learners need no
# GitHub token to install it (D-090).
#
# Usage: tools/release-bundle.sh <version> [out-dir]
set -euo pipefail

version="${1:?usage: tools/release-bundle.sh <version> [out-dir]}"
out="$(cd "${2:-.}" && pwd)"
name="proginone-${version}"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

git archive --format=tar --prefix="${name}/" HEAD | tar -x -C "$stage"
mkdir -p "$stage/$name/apps/web" "$stage/$name/content/dist"
cp -R apps/web/dist "$stage/$name/apps/web/dist"
cp content/dist/content.db "$stage/$name/content/dist/content.db"
node tools/vendor-proginone.mjs "$stage/$name"

tar -C "$stage" -cf - "$name" | gzip -9 > "$out/${name}.tar.gz"
(cd "$out" && shasum -a 256 "${name}.tar.gz" > "${name}.tar.gz.sha256")
echo "Wrote $out/${name}.tar.gz"
