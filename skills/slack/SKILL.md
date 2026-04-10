# Slack CLI

Use `slack` to search messages and files, inspect channels, read threads, and find unanswered messages.

## Setup

Run `slack init` to save your Slack User OAuth token to `~/.config/slack/.env`.  
Token must start with `xoxp-`.

Required token scopes: `channels:read`, `groups:read`, `im:read`, `mpim:read`, `search:read`, `users:read`, `reactions:read`.

Override the saved token with `SLACK_USER_TOKEN` in a local `.env` or in the environment.

## Commands

All commands write JSON to stdout (pretty-printed). Errors are written to stderr as `{"error": "..."}`.

### Search

```
slack search-messages -q <query> [-c count] [-p page] [--sort timestamp|score] [--sort-dir asc|desc]
slack search-files    -q <query> [-c count] [-p page] [--sort timestamp|score] [--sort-dir asc|desc]
```

Default count: 20 (max 100). Default sort: `timestamp desc`.  
Query supports Slack modifiers: `in:#channel`, `from:@user`, `has:link`, `before:YYYY-MM-DD`, `after:YYYY-MM-DD`.

### Threads

```
slack get-thread -t <ts|url> [-c channel] [-l limit] [-a] [--include-parent] [--resolve-users]
```

Accepts a raw timestamp (`1774620901.236209`) or a full Slack message URL (channel extracted automatically).  
`-a` / `--all` paginates through all replies. `--include-parent` (default: true) includes the root message.

### Channels

```
slack list-channels [--types public_channel,private_channel] [-l limit] [--include-archived]
slack get-channel   -c <channel>
slack resolve-channel -c <channel>
```

`resolve-channel` accepts a channel name (`#general`, `general`) or ID (`C0123ABCD`) and returns the resolved channel. Uses a local name→ID cache.

### Unanswered messages

```
slack find-unanswered -c <channel> [--hours N] [--max N] [--resolve-users]
```

Returns messages with no replies and no reactions, older than `--hours` (default: 720 = 30 days). Default max: 50.

### Config

```
slack init
```

Interactive setup: prompts for token, validates with `auth.test`, saves to `~/.config/slack/.env`.

## Typical agent workflows

**Find recent discussion on a topic:**
```
slack search-messages -q "deployment failed" -c 20
```

**Read a full thread from a URL:**
```
slack get-thread -t "https://yourworkspace.slack.com/archives/C123/p1774620901236209" --resolve-users
```

**Find unaddressed questions in a support channel:**
```
slack find-unanswered -c C0123ABCD --hours 48 --resolve-users
```

**List all private channels:**
```
slack list-channels --types private_channel -l 200
```

## Output format

Every command emits a single JSON value on stdout.

- `search-messages` → `{ messages: { matches: [...], pagination: {...} } }`
- `get-thread` → `{ messages: [...], has_more: bool }`
- `list-channels` → `{ channels: [...], response_metadata: { next_cursor } }`
- `find-unanswered` → `{ messages: [...], total_checked: N }`

## Notes

- Channel IDs start with `C` (public), `G` (private/group), or `D` (DM) + uppercase alphanumerics.
- User IDs start with `U` + uppercase alphanumerics.
- Name→ID and display-name mappings are cached in `~/.config/slack/mappings.json`. Set `SLACK_CACHE_MAPPINGS=false` to disable.
