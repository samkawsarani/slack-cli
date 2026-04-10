#!/usr/bin/env node
import { Command } from "commander";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { CONFIG_DIR, CONFIG_ENV, SlackClient, loadConfig } from "./client.js";
import {
  searchMessages,
  searchFiles,
  getThreadReplies,
  getAllThreadReplies,
  listChannels,
  getChannelInfo,
  resolveChannel,
  findUnansweredMessages,
  parseSlackMessageLink,
} from "./slack.js";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const program = new Command();

program
  .name("slack")
  .description("Slack integration CLI")
  .version(pkg.version);

// ---------------------------------------------------------------------------
// init
// ---------------------------------------------------------------------------

program
  .command("init")
  .description("Configure Slack API credentials")
  .addHelpText(
    "after",
    `
Config is saved to: ~/.config/slack/.env
Override any value with a local .env in the current directory.

Required token scopes: channels:read, groups:read, im:read, mpim:read,
  search:read, users:read, reactions:read`,
  )
  .action(async () => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const ask = (q: string): Promise<string> =>
      new Promise((resolve) => rl.question(q, resolve));

    console.log("Slack CLI Setup");
    console.log("=".repeat(40));
    console.log();
    console.log("You need a Slack User OAuth token (xoxp-...).");
    console.log(
      "Create one at: https://api.slack.com/apps > OAuth & Permissions",
    );
    console.log();

    loadConfig();
    const existing = process.env.SLACK_USER_TOKEN;
    if (existing) {
      const masked =
        existing.length > 12
          ? existing.slice(0, 8) + "..." + existing.slice(-4)
          : "***";
      console.log(`Current token: ${masked}`);
      const confirm = (await ask("Replace existing token? [y/N]: "))
        .trim()
        .toLowerCase();
      if (confirm !== "y") {
        console.log("Keeping existing token.");
        rl.close();
        return;
      }
    }

    const token = (
      await ask("Enter your Slack user token (xoxp-...): ")
    ).trim();
    if (!token) {
      console.error("No token provided. Aborting.");
      rl.close();
      process.exit(1);
    }

    if (!token.startsWith("xoxp-")) {
      console.log(
        "Warning: Token doesn't start with 'xoxp-'. Slack user tokens typically do.",
      );
      const confirm = (await ask("Continue anyway? [y/N]: "))
        .trim()
        .toLowerCase();
      if (confirm !== "y") {
        console.log("Aborting.");
        rl.close();
        return;
      }
    }

    process.stdout.write("Validating token... ");
    let validated = false;
    try {
      const client = new SlackClient(token);
      const result = await client.get("auth.test");
      const user = (result["user"] as string) ?? "unknown";
      const team = (result["team"] as string) ?? "unknown";
      console.log("OK");
      console.log(`Authenticated as: ${user} in workspace: ${team}`);
      validated = true;
    } catch (e) {
      console.log("FAILED");
      console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
      const saveAnyway = (
        await ask("Save token anyway? [y/N]: ")
      )
        .trim()
        .toLowerCase();
      if (saveAnyway !== "y") {
        console.log("Aborting.");
        rl.close();
        return;
      }
    }

    // Save token to config
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const envPath = CONFIG_ENV;
    let lines: string[] = [];
    if (fs.existsSync(envPath)) {
      lines = fs.readFileSync(envPath, "utf8").split("\n");
    }
    lines = lines.filter((l) => !l.startsWith("SLACK_"));
    lines.push(`SLACK_USER_TOKEN=${token}`);
    fs.writeFileSync(envPath, lines.join("\n") + "\n");
    fs.chmodSync(envPath, 0o600);

    console.log();
    console.log(`Configuration saved to ~/.config/slack/.env`);
    if (validated) {
      console.log("Override any value by setting it in a local .env file.");
      console.log("Run `slack list-channels` to get started.");
    }
    rl.close();
  });

// ---------------------------------------------------------------------------
// search-messages
// ---------------------------------------------------------------------------

program
  .command("search-messages")
  .description("Search for messages")
  .addHelpText(
    "after",
    `
Examples:
  slack search-messages --query "deployment failed"
  slack search-messages --query "in:#general bug" --count 50
  slack search-messages --query "from:@alice" --sort score`,
  )
  .requiredOption("-q, --query <query>", "Search query")
  .option("-c, --count <count>", "Results per page (max 100)", "20")
  .option("-p, --page <page>", "Page number", "1")
  .option("--sort <sort>", "Sort field: timestamp or score", "timestamp")
  .option("--sort-dir <dir>", "Sort direction: asc or desc", "desc")
  .action(async (opts) => {
    const result = await searchMessages({
      query: opts.query,
      count: parseInt(opts.count, 10),
      page: parseInt(opts.page, 10),
      sort: opts.sort,
      sortDir: opts.sortDir,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// search-files
// ---------------------------------------------------------------------------

program
  .command("search-files")
  .description("Search for files")
  .requiredOption("-q, --query <query>", "Search query")
  .option("-c, --count <count>", "Results per page", "20")
  .option("-p, --page <page>", "Page number", "1")
  .option("--sort <sort>", "Sort field: timestamp or score", "timestamp")
  .option("--sort-dir <dir>", "Sort direction: asc or desc", "desc")
  .action(async (opts) => {
    const result = await searchFiles({
      query: opts.query,
      count: parseInt(opts.count, 10),
      page: parseInt(opts.page, 10),
      sort: opts.sort,
      sortDir: opts.sortDir,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// get-thread
// ---------------------------------------------------------------------------

program
  .command("get-thread")
  .description("Get thread replies")
  .addHelpText(
    "after",
    `
Examples:
  # Paste a Slack message URL directly (channel extracted automatically)
  slack get-thread --thread-ts "https://workspace.slack.com/archives/C123/p1774620901236209"

  # Or provide channel + timestamp explicitly
  slack get-thread --channel C123 --thread-ts 1774620901.236209
  slack get-thread --channel C123 --thread-ts 1774620901.236209 --all`,
  )
  .option("-c, --channel <channel>", "Channel ID (not needed if --thread-ts is a Slack URL)")
  .requiredOption("-t, --thread-ts <ts>", "Thread timestamp or full Slack message URL")
  .option("-l, --limit <limit>", "Max replies", "200")
  .option("-a, --all", "Get all replies (paginated)")
  .option("--include-parent", "Include parent message", true)
  .option("--resolve-users", "Resolve user IDs to names")
  .action(async (opts) => {
    let channel: string = opts.channel;
    let threadTs: string = opts.threadTs;

    const parsed = parseSlackMessageLink(opts.threadTs);
    if (parsed) {
      channel = parsed.channelId;
      threadTs = parsed.threadTs ?? parsed.messageTs;
    }

    if (!channel) {
      console.error(JSON.stringify({ error: "--channel is required when --thread-ts is not a Slack URL" }));
      process.exit(1);
    }

    let result;
    if (opts.all) {
      result = await getAllThreadReplies({
        channel,
        threadTs,
        includeParent: opts.includeParent ?? true,
        resolveUsers: opts.resolveUsers ?? false,
      });
    } else {
      result = await getThreadReplies({
        channel,
        threadTs,
        limit: parseInt(opts.limit, 10),
        resolveUsers: opts.resolveUsers ?? false,
      });
    }
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// list-channels
// ---------------------------------------------------------------------------

program
  .command("list-channels")
  .description("List channels")
  .option(
    "--types <types>",
    "Channel types",
    "public_channel,private_channel",
  )
  .option("-l, --limit <limit>", "Max channels", "100")
  .option("--include-archived", "Include archived channels")
  .action(async (opts) => {
    const result = await listChannels({
      types: opts.types,
      limit: parseInt(opts.limit),
      excludeArchived: !opts.includeArchived,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// get-channel
// ---------------------------------------------------------------------------

program
  .command("get-channel")
  .description("Get channel info")
  .requiredOption("-c, --channel <channel>", "Channel ID")
  .action(async (opts) => {
    const result = await getChannelInfo(opts.channel);
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// resolve-channel
// ---------------------------------------------------------------------------

program
  .command("resolve-channel")
  .description("Resolve channel name or ID (checks cache, then API)")
  .requiredOption("-c, --channel <channel>", "Channel name or ID")
  .action(async (opts) => {
    const result = await resolveChannel(opts.channel);
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// find-unanswered
// ---------------------------------------------------------------------------

program
  .command("find-unanswered")
  .description("Find messages with no replies and no reactions")
  .requiredOption("-c, --channel <channel>", "Channel ID")
  .option(
    "--hours <hours>",
    "Only messages older than N hours (default: 720 = 30 days)",
    "720",
  )
  .option("--max <max>", "Maximum messages to return (default: 50)", "50")
  .option("--resolve-users", "Resolve user IDs to display names")
  .action(async (opts) => {
    const result = await findUnansweredMessages({
      channel: opts.channel,
      hoursOld: parseInt(opts.hours, 10),
      maxResults: parseInt(opts.max, 10),
      resolveUsers: opts.resolveUsers ?? false,
    });
    console.log(JSON.stringify(result, null, 2));
  });

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(
    JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
  );
  process.exit(1);
});
