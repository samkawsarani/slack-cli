# Changelog

## [Unreleased]

## [1.1.0] - 2026-04-10

- Add `install-skill` command: writes `skills/slack/SKILL.md` to `.agents/skills/slack/` (or `~/.agents/skills/slack/` with `--global`) and optionally symlinks `.claude/skills/slack/`.

## [1.0.1] - 2026-04-10

- Updated readme
- CI: `actions/checkout@v5`, `actions/setup-node@v5`, Node 24 for npm publish (avoids Node 20 action-runtime deprecation warning).
- Fix CLI bundle: strip Bun’s injected shebang before prepending `#!/usr/bin/env node` so `slack` runs under Node without a duplicate-shebang `SyntaxError`.

## [1.0.0] - 2026-04-09

- Initial public release: TypeScript CLI (`slack`), library API, and npm package `@samkawsarani/slack-cli`.
