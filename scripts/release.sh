#!/usr/bin/env bash
set -euo pipefail

# Release script
#
# Renames [Unreleased] in CHANGELOG.md to the new version, bumps package.json,
# commits, and creates an annotated tag. The actual publish happens via GitHub
# Actions when the tag is pushed.
#
# Usage: ./scripts/release.sh [patch|minor|major|<version>]
# Examples:
#   ./scripts/release.sh patch     # 1.0.0 -> 1.0.1
#   ./scripts/release.sh minor     # 1.0.0 -> 1.1.0
#   ./scripts/release.sh major     # 1.0.0 -> 2.0.0
#   ./scripts/release.sh 1.2.0     # explicit version

BUMP="${1:?Usage: release.sh [patch|minor|major|<version>]}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

# Must be on main
BRANCH=$(git branch --show-current)
if [[ "$BRANCH" != "main" ]]; then
  echo "Error: must be on main branch (currently on $BRANCH)" >&2
  exit 1
fi

# Must be clean
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Error: working directory not clean" >&2
  git status --short
  exit 1
fi

# Verify lockfile is in sync
if ! bun install --frozen-lockfile &>/dev/null; then
  echo "Error: bun.lockb is out of sync with package.json" >&2
  echo "Run 'bun install' and commit the updated lockfile." >&2
  exit 1
fi
echo "bun.lockb: in sync ✓"

# Require jq
if ! command -v jq &>/dev/null; then
  echo "Error: jq is required. Install with: brew install jq" >&2
  exit 1
fi

# Read current version
CURRENT=$(jq -r .version package.json)
echo "Current version: $CURRENT"

bump_version() {
  local current="$1" type="$2"
  IFS='.' read -r major minor patch <<< "$current"
  case "$type" in
    major) echo "$((major + 1)).0.0" ;;
    minor) echo "$major.$((minor + 1)).0" ;;
    patch) echo "$major.$minor.$((patch + 1))" ;;
    *)     echo "$type" ;;
  esac
}

NEW=$(bump_version "$CURRENT" "$BUMP")
DATE=$(date +%Y-%m-%d)
echo "New version:     $NEW"
echo ""

# Validate CHANGELOG.md
if [[ ! -f CHANGELOG.md ]]; then
  echo "Error: CHANGELOG.md not found" >&2
  exit 1
fi

if ! grep -q "^## \[Unreleased\]" CHANGELOG.md; then
  echo "Error: no [Unreleased] section in CHANGELOG.md" >&2
  echo "" >&2
  echo "Add your changes under an [Unreleased] heading first:" >&2
  echo "" >&2
  echo "  ## [Unreleased]" >&2
  echo "" >&2
  echo "  - Your change here" >&2
  exit 1
fi

# Preview release notes
echo "--- Release notes (will appear on GitHub) ---"
bash scripts/extract-changelog.sh "$NEW"
echo "--- End ---"
echo ""

# Confirm
read -rp "Release v$NEW? [y/N] " confirm
[[ "$confirm" =~ ^[yY]$ ]] || { echo "Aborted."; exit 1; }

# Rename [Unreleased] -> [X.Y.Z] - date
sed -i '' "s/^## \[Unreleased\].*/## [$NEW] - $DATE/" CHANGELOG.md

# Insert a fresh [Unreleased] section above the new version entry
awk -v ver="$NEW" '
  /^\#\# \['"$NEW"'\]/ && !done {
    print "## [Unreleased]\n"
    done = 1
  }
  { print }
' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md

# Bump version in package.json
jq --arg v "$NEW" '.version = $v' package.json > package.json.tmp && mv package.json.tmp package.json

git add package.json CHANGELOG.md
git commit -m "release: v$NEW"
git tag -a "v$NEW" -m "v$NEW"

echo ""
echo "Created commit and tag v$NEW"
echo ""
echo "Next: push to trigger the publish workflow"
echo ""
echo "  git push origin main --tags"
