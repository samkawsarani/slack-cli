# slack-cli — Agent Guide

## Package manager

Use Bun instead of Node.js (`bun` not `node`, `bun install` not `npm install`) for all operations:

```bash
bun install              # install dependencies
bun test                 # run tests
bun run build            # build dist/slack.js + dist/lib/
bun run src/cli.ts       # run CLI locally without building
```

## Architecture

Three layers, top to bottom:

- **`cli.ts`** — parses flags, calls business logic, prints JSON. No API calls directly.
- **`slack.ts`** — all business logic: `searchMessages`, `listChannels`, `getThreadReplies`, `findUnansweredMessages`, channel/user caching. This is where Slack API coordination happens.
- **`client.ts`** — `SlackClient` wraps `fetch`. Handles auth header, 429 retries (up to 3), and error parsing. `getClient()` returns a singleton; `loadConfig()` reads env vars.

Config resolution order (highest priority first): local `.env` in cwd → `~/.config/slack/.env` → environment variables.

`index.ts` re-exports the public library API from `slack.ts` and `client.ts`. The CLI is a separate bundle and is not part of the library.

`dist/` is gitignored — do not commit built files manually.

## Testing

All tests are in `tests/slack.test.ts` and use `bun:test`.

**What's mocked:** The HTTP client — tests use `_setClient()` to inject a fake `SlackClient`. No real network calls in unit tests.

**What's real:** Integration tests hit the real Slack API and require `SLACK_USER_TOKEN`. They are skipped automatically if the token is not set.

```bash
bun test                          # run all tests (integration skipped without token)
bun test -t "searchMessages"      # run a single test by name
```

## Local dev workflow

```bash
bun run src/cli.ts list-channels              # run CLI without building
bun run build                                 # produce dist/slack.js

# End-to-end against the real API:
# Set SLACK_USER_TOKEN in ~/.config/slack/.env or a local .env, then:
bun run src/cli.ts search-messages --query "bug"
```

## What to avoid

- **Do not call the Slack API directly from `cli.ts`** — keep all API calls inside `slack.ts` or `client.ts`.
- **Do not pass `SlackClient` as a function parameter** — use the `getClient()` singleton.
- **Do not edit `~/.config/slack/mappings.json` manually** — it is managed by the caching layer. Use `clearMappings()` or set `SLACK_CACHE_MAPPINGS=false` to reset.
- **Do not add breaking changes to the public library API** (`index.ts` exports) without a major version bump.
- **Do not use `_setClient`** outside of tests — it's test-internal infrastructure.
- **Always update `CHANGELOG.md`** under `## [Unreleased]` when making any code changes.

## Error handling

`SlackClient` throws `APIError` on non-2xx HTTP responses or when the Slack API returns `ok: false`:

```typescript
import { APIError } from "../src/client";

try {
  await searchMessages({ query: "test" });
} catch (e) {
  if (e instanceof APIError) {
    e.statusCode; // number | null — e.g. 401, 429, or null for Slack-level errors
    e.message;    // e.g. "Slack API error: not_authed"
    e.response;   // raw response body or Slack error payload
  }
}
```

401 means bad/missing token. 429 is rate-limited (client retries automatically up to 3 times).

## Versioning & releasing

1. Add changes under `## [Unreleased]` in `CHANGELOG.md`
2. Run `./scripts/release.sh patch` (or `minor` / `major`)
   - Bumps `package.json`, renames `[Unreleased]` in `CHANGELOG.md`, commits, and tags
3. Run `git push origin main --tags`
   - GitHub Actions runs tests, builds, creates a GitHub release, and publishes to npm

## Project structure

```
src/
  client.ts    # SlackClient, APIError, getClient(), loadConfig()
  slack.ts     # All business logic / operations
  cli.ts       # CLI entry point (commander)
  index.ts     # Public library API re-exports
tests/
  slack.test.ts  # Unit + integration tests (bun:test)
dist/          # gitignored — built by scripts/build.sh
  lib/         # Published library (tsc from tsconfig.build.json)
  slack.js     # CLI bundle (bun build)
scripts/
  build.sh           # tsc → dist/lib; bundle src/cli.ts → dist/slack.js
  release.sh         # Bump version, update CHANGELOG, commit + tag
  extract-changelog.sh  # Extract release notes for GitHub releases
.github/
  workflows/
    publish.yml  # Triggered on tag push: test, build, GitHub release, npm publish
```
