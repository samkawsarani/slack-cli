#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

rm -rf dist
mkdir -p dist

echo "Compiling library to dist/lib …"
bun x tsc -p tsconfig.build.json

echo "Bundling CLI to dist/slack.js …"
bun build src/cli.ts --outfile dist/slack.js --target node

# Prepend Node.js shebang so the file is directly executable
printf '#!/usr/bin/env node\n' | cat - dist/slack.js > dist/slack.tmp
mv dist/slack.tmp dist/slack.js
chmod +x dist/slack.js

echo "Built dist/lib and dist/slack.js"
