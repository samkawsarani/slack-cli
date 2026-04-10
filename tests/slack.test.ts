/**
 * Tests for Slack integration.
 *
 * Run with: bun test
 *
 * Unit tests (link parsing, caching) run without credentials.
 * Integration tests require SLACK_USER_TOKEN and are skipped if not set.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  parseSlackMessageLink,
  buildSlackMessageUrl,
  isSlackUrl,
  getChannelId,
  setChannelMapping,
  getUserId,
  setUserMapping,
  getCachedDisplayName,
  setUserDisplayName,
  upsertUserCache,
  clearMappings,
  isCachingEnabled,
  listChannels,
  getChannelInfo,
  resolveChannel,
  listMessages,
  findUnansweredMessages,
  getThreadReplies,
  searchMessages,
  searchFiles,
  getUser,
  listUsers,
  findUserByHandle,
  getUserDisplayName,
  getChannelDaySummary,
} from "../src/slack.js";
import { getClient } from "../src/client.js";

const hasToken = Boolean(process.env.SLACK_USER_TOKEN);

function requiresApi(name: string, fn: () => void | Promise<void>) {
  if (!hasToken) {
    test.skip(name, fn);
  } else {
    test(name, fn);
  }
}

// ---------------------------------------------------------------------------
// Unit Tests — Link parsing
// ---------------------------------------------------------------------------

describe("parseSlackMessageLink", () => {
  test("parses basic message link", () => {
    const result = parseSlackMessageLink(
      "https://myteam.slack.com/archives/C12345678/p1700000000000123",
    );
    expect(result).not.toBeNull();
    expect(result!.channelId).toBe("C12345678");
    expect(result!.messageTs).toBe("1700000000.000123");
    expect(result!.threadTs).toBeNull();
    expect(result!.teamDomain).toBe("myteam");
  });

  test("parses threaded message link", () => {
    const result = parseSlackMessageLink(
      "https://company.slack.com/archives/C98765432/p1705123456789012" +
        "?thread_ts=1705000000.000001&cid=C98765432",
    );
    expect(result).not.toBeNull();
    expect(result!.channelId).toBe("C98765432");
    expect(result!.messageTs).toBe("1705123456.789012");
    expect(result!.threadTs).toBe("1705000000.000001");
  });

  test("returns null for non-Slack URL", () => {
    expect(parseSlackMessageLink("https://github.com/user/repo")).toBeNull();
  });

  test("returns null for invalid path", () => {
    expect(
      parseSlackMessageLink("https://myteam.slack.com/messages/general"),
    ).toBeNull();
  });
});

describe("buildSlackMessageUrl", () => {
  test("builds basic message URL", () => {
    const url = buildSlackMessageUrl("myteam", "C12345678", "1700000000.000123");
    expect(url).toBe(
      "https://myteam.slack.com/archives/C12345678/p1700000000000123",
    );
  });

  test("builds URL with thread_ts", () => {
    const url = buildSlackMessageUrl(
      "myteam",
      "C12345678",
      "1700000000.000123",
      "1699999999.000001",
    );
    expect(url).toContain("thread_ts=1699999999.000001");
    expect(url).toContain("cid=C12345678");
  });
});

describe("isSlackUrl", () => {
  test("returns true for Slack URL", () => {
    expect(isSlackUrl("https://myteam.slack.com/archives/C123/p456")).toBe(
      true,
    );
  });

  test("returns false for non-Slack URL", () => {
    expect(isSlackUrl("https://github.com/user/repo")).toBe(false);
  });

  test("returns false for invalid URL", () => {
    expect(isSlackUrl("not-a-url")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit Tests — Channel mapping cache
// ---------------------------------------------------------------------------

describe("channel mapping cache", () => {
  beforeEach(() => clearMappings());
  afterEach(() => clearMappings());

  test("set and get channel mapping", () => {
    setChannelMapping("test-channel", "C99999TEST");
    expect(getChannelId("test-channel")).toBe("C99999TEST");
  });

  test("# prefix handling", () => {
    setChannelMapping("test-channel", "C99999TEST");
    expect(getChannelId("#test-channel")).toBe("C99999TEST");
  });

  test("case insensitive lookup", () => {
    setChannelMapping("test-channel", "C99999TEST");
    expect(getChannelId("TEST-CHANNEL")).toBe("C99999TEST");
  });

  test("channel ID passthrough", () => {
    expect(getChannelId("C12345ABCD")).toBe("C12345ABCD");
  });

  test("returns null for unknown channel name", () => {
    expect(getChannelId("nonexistent")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Unit Tests — User mapping cache
// ---------------------------------------------------------------------------

describe("user mapping cache", () => {
  beforeEach(() => clearMappings());
  afterEach(() => clearMappings());

  test("set and get user mapping", () => {
    setUserMapping("jsmith", "U12345ABC");
    expect(getUserId("jsmith")).toBe("U12345ABC");
  });

  test("set and get display name", () => {
    setUserDisplayName("U12345ABC", "John Smith");
    expect(getCachedDisplayName("U12345ABC")).toBe("John Smith");
  });

  test("batch upsert", () => {
    upsertUserCache([
      { id: "U111", handle: "alice", display_name: "Alice Anderson" },
      { id: "U222", handle: "bob", display_name: "Bob Builder" },
    ]);
    expect(getUserId("alice")).toBe("U111");
    expect(getUserId("bob")).toBe("U222");
    expect(getCachedDisplayName("U111")).toBe("Alice Anderson");
    expect(getCachedDisplayName("U222")).toBe("Bob Builder");
  });

  test("clear mappings", () => {
    setUserMapping("jsmith", "U12345ABC");
    setUserDisplayName("U12345ABC", "John Smith");
    clearMappings();
    expect(getUserId("jsmith")).toBeNull();
    expect(getCachedDisplayName("U12345ABC")).toBeNull();
  });
});

describe("user cache normalization", () => {
  beforeEach(() => clearMappings());
  afterEach(() => clearMappings());

  test("@ prefix removal", () => {
    setUserMapping("@testuser", "U99999");
    expect(getUserId("testuser")).toBe("U99999");
  });

  test("case insensitive", () => {
    setUserMapping("MixedCase", "U88888");
    expect(getUserId("mixedcase")).toBe("U88888");
    expect(getUserId("MIXEDCASE")).toBe("U88888");
  });

  test("@ prefix and case combined", () => {
    setUserMapping("@testuser", "U99999");
    expect(getUserId("@TestUser")).toBe("U99999");
  });
});

describe("user ID passthrough", () => {
  beforeEach(() => clearMappings());
  afterEach(() => clearMappings());

  test("user ID passes through without cache", () => {
    expect(getUserId("U12345ABC")).toBe("U12345ABC");
  });

  test("user ID passthrough with empty cache", () => {
    expect(getUserId("UABCDEFGH")).toBe("UABCDEFGH");
  });

  test("non-cached handle returns null", () => {
    expect(getUserId("nonexistent")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integration Tests (require SLACK_USER_TOKEN)
// ---------------------------------------------------------------------------

describe("auth", () => {
  requiresApi("auth.test succeeds", async () => {
    const client = getClient();
    const result = await client.get("auth.test");
    expect(result["user"]).toBeTruthy();
    expect(result["team"]).toBeTruthy();
  });
});

describe("channel operations", () => {
  requiresApi("list channels", async () => {
    const result = await listChannels({ limit: 5 });
    expect(result.channels.length).toBeGreaterThan(0);
  });

  requiresApi("channels have id and name", async () => {
    const result = await listChannels({ limit: 1 });
    if (result.channels.length > 0) {
      expect(result.channels[0]["id"]).toBeTruthy();
      expect(result.channels[0]["name"]).toBeTruthy();
    }
  });

  requiresApi("get channel info", async () => {
    const result = await listChannels({ limit: 1 });
    if (result.channels.length === 0) return;
    const info = await getChannelInfo(result.channels[0]["id"] as string, true);
    expect(info["name"]).toBeTruthy();
  });

  requiresApi("resolve nonexistent channel returns ok:false", async () => {
    const result = await resolveChannel("nonexistent-channel-xyz-123");
    expect(result.ok).toBe(false);
    expect(result.error?.toLowerCase()).toContain("not found");
  });
});

describe("message operations", () => {
  requiresApi("list messages", async () => {
    const channels = await listChannels({ limit: 1 });
    if (channels.channels.length === 0) return;
    const result = await listMessages({
      channel: channels.channels[0]["id"] as string,
      limit: 5,
    });
    expect(result.messages).toBeDefined();
  });

  requiresApi("find unanswered messages", async () => {
    const channels = await listChannels({ limit: 1 });
    if (channels.channels.length === 0) return;
    const result = await findUnansweredMessages({
      channel: channels.channels[0]["id"] as string,
      hoursOld: 168,
      maxResults: 5,
    });
    expect(result.messages).toBeDefined();
    expect(typeof result.total_checked).toBe("number");
  });

  requiresApi("get thread replies", async () => {
    const channels = await listChannels({ limit: 1 });
    if (channels.channels.length === 0) return;
    const channelId = channels.channels[0]["id"] as string;
    const msgs = await listMessages({ channel: channelId, limit: 20 });
    const threadMsg = msgs.messages.find(
      (m) => (m["reply_count"] as number) > 0,
    );
    if (!threadMsg) return; // no threaded message, skip
    const result = await getThreadReplies({
      channel: channelId,
      threadTs: threadMsg["ts"] as string,
      limit: 10,
    });
    expect(result.messages.length).toBeGreaterThan(0);
  });
});

describe("search operations", () => {
  requiresApi("search messages", async () => {
    const result = await searchMessages({ query: "*", count: 3 });
    expect(result.matches).toBeDefined();
    expect(typeof result.total).toBe("number");
  });

  requiresApi("search files", async () => {
    const result = await searchFiles({ query: "*", count: 3 });
    expect(result.matches).toBeDefined();
    expect(typeof result.total).toBe("number");
  });
});

describe("user operations", () => {
  requiresApi("list users", async () => {
    const result = await listUsers({ includeBots: false, limit: 10 });
    expect(result.members.length).toBeGreaterThan(0);
  });

  requiresApi("get user", async () => {
    const result = await listUsers({ includeBots: false, limit: 1 });
    if (result.members.length === 0) return;
    const userId = result.members[0]["id"] as string;
    const user = await getUser(userId);
    expect(user).toBeTruthy();
    expect(getUserDisplayName(user)).toBeTruthy();
  });

  requiresApi("find user by handle", async () => {
    const result = await listUsers({ includeBots: false, limit: 1 });
    if (result.members.length === 0) return;
    const handle = result.members[0]["name"] as string;
    if (!handle) return;
    const found = await findUserByHandle(handle);
    expect(found).not.toBeNull();
    expect(found!["id"]).toBe(result.members[0]["id"]);
  });
});

describe("channel day summary", () => {
  requiresApi("get channel day summary", async () => {
    const channels = await listChannels({ limit: 1 });
    if (channels.channels.length === 0) return;
    const summary = await getChannelDaySummary({
      channel: channels.channels[0]["id"] as string,
    });
    expect(summary.date).toBeTruthy();
    expect(typeof summary.messageCount).toBe("number");
  });
});

describe("user caching integration", () => {
  beforeEach(() => clearMappings());

  requiresApi("get user populates cache", async () => {
    if (!isCachingEnabled()) return;
    const result = await listUsers({ includeBots: false, limit: 1 });
    if (result.members.length === 0) return;
    const userId = result.members[0]["id"] as string;
    const user = await getUser(userId);
    const handle = user["name"] as string;
    const displayName = getUserDisplayName(user);
    if (handle) {
      expect(getUserId(handle)).toBe(userId);
    }
    expect(getCachedDisplayName(userId)).toBe(displayName);
  });
});
