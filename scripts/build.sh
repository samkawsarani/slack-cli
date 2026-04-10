#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist

mkdir -p dist/skills/slack
cp skills/slack/SKILL.md dist/skills/slack/SKILL.md

echo "Compiling library to dist/lib …"
bun x tsc -p tsconfig.build.json

echo "Bundling CLI to dist/slack.js …"
bun build src/cli.ts --outfile dist/slack.js --target node

# Bun may inject its own shebang; strip it so we don't end up with two (Node ESM only strips the first line).
if [[ "$(head -c2 dist/slack.js 2>/dev/null)" == '#!' ]]; then
  tail -n +2 dist/slack.js > dist/slack.body
  mv dist/slack.body dist/slack.js
fi

# Single shebang for direct execution
printf '#!/usr/bin/env node\n' | cat - dist/slack.js > dist/slack.tmp
mv dist/slack.tmp dist/slack.js
chmod +x dist/slack.js

echo "Built dist/lib and dist/slack.js"
