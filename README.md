# slack-cli

[![npm](https://img.shields.io/npm/v/@samkawsarani/slack-cli)](https://www.npmjs.com/package/@samkawsarani/slack-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [!IMPORTANT]
> **Disclaimer**: This is an **unofficial, open-source community project** and is **not affiliated with, endorsed by, or connected to Slack Technologies, LLC** (the company behind [Slack.com](https://www.slack.com)). Slack is a registered trademark of Slack Technologies, LLC. This CLI is an independent tool that uses the publicly available Slack API to provide command-line access to your own slack data.

> [!NOTE]
> This tool has only been tested on **macOS**. It may work on Windows and Linux, but this has not been verified.

Read-only Slack API client with CLI. Built for use by LLM agents and humans.

## Installation

```bash
npm install -g @samkawsarani/slack-cli
# or
bun add -g @samkawsarani/slack-cli
```

## Quick Start

```bash
# Interactive setup 
slack init

# Search
slack search-messages --query "bug report"
slack search-files --query "design doc"

# Channels
slack list-channels
slack get-channel --channel C12345678
slack resolve-channel --channel general

# Threads — paste a Slack message URL directly (right-click message → Copy link)
slack get-thread --thread-ts "https://workspace.slack.com/archives/C12345678/p1700000000000123"
# Or provide channel + timestamp explicitly
slack get-thread --channel C12345678 --thread-ts 1700000000.000123
slack get-thread --channel C12345678 --thread-ts 1700000000.000123 --all

# Find unanswered messages
slack find-unanswered --channel C12345678 --hours 48 --resolve-users
```

## Library Usage

```typescript
import {
  searchMessages,
  listChannels,
  resolveChannel,
  getThreadReplies,
  getChannelDaySummary,
} from "@samkawsarani/slack-cli";

// Search messages
const results = await searchMessages({ query: "bug report" });

// List channels
const { channels } = await listChannels({ limit: 50 });

// Resolve channel by name
const resolved = await resolveChannel("general");

// Get thread replies
const thread = await getThreadReplies({
  channel: "C12345678",
  threadTs: "1700000000.000123",
});

// Get a day's activity in a channel
const summary = await getChannelDaySummary({ channel: "general" });
console.log(summary.messageCount, summary.topParticipants);
```

## Available Functions

| Category | Functions |
|----------|-----------|
| Messages | `listMessages`, `findUnansweredMessages` |
| Channels | `listChannels`, `getChannelInfo`, `resolveChannel` |
| Search   | `searchMessages`, `searchFiles` |
| Users    | `getUser`, `listUsers`, `findUserByHandle`, `getUserDisplayName` |
| Threads  | `getThreadReplies`, `getAllThreadReplies` |
| URLs     | `parseSlackMessageLink`, `buildSlackMessageUrl`, `isSlackUrl` |
| Summary  | `getChannelDaySummary` |
| Caching  | `loadMappings`, `saveMappings`, `getChannelId`, `setChannelMapping`, `getUserId`, `setUserMapping`, `clearMappings` |

## Configuration

Config is stored at `~/.config/slack/.env` — works globally from any directory. A `.env` in the current working directory overrides the global config.

| Variable | Required | Default | Description |
|---|---|---|---|
| `SLACK_USER_TOKEN` | Yes | — | Slack User OAuth token (`xoxp-...`). Get one at api.slack.com/apps |
| `SLACK_CACHE_MAPPINGS` | No | `true` | Cache channel/user ID↔name mappings in `~/.config/slack/mappings.json`. Set to `false` to disable |

## License

[MIT](LICENSE) — Copyright (c) 2026 Sam Kawsarani