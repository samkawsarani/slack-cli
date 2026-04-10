import * as fs from "fs";
import * as path from "path";
import { getClient, CONFIG_DIR } from "./client.js";

// ---------------------------------------------------------------------------
// Mapping — ID/name cache for channels and users
// ---------------------------------------------------------------------------

const MAPPINGS_FILE = path.join(CONFIG_DIR, "mappings.json");

export interface Mappings {
  version: number;
  updated_at: string;
  channels: Record<string, string>;
  users: Record<string, string>;
  user_id_to_name: Record<string, string>;
}

export function isCachingEnabled(): boolean {
  const val = process.env.SLACK_CACHE_MAPPINGS;
  if (val === undefined) return true;
  return val !== "false" && val !== "0";
}

function normalizeChannelName(name: string): string {
  return name.trim().replace(/^#/, "").toLowerCase();
}

function normalizeUserHandle(handle: string): string {
  return handle.trim().replace(/^@/, "").toLowerCase();
}

function isChannelId(value: string): boolean {
  return /^[CGD][A-Z0-9]+$/.test(value.trim());
}

function isUserId(value: string): boolean {
  return /^U[A-Z0-9]+$/.test(value.trim());
}

function emptyMappings(): Mappings {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    channels: {},
    users: {},
    user_id_to_name: {},
  };
}

export function loadMappings(): Mappings {
  if (!fs.existsSync(MAPPINGS_FILE)) return emptyMappings();
  try {
    const data = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8")) as Partial<Mappings>;
    return {
      version: 1,
      updated_at: data.updated_at ?? new Date().toISOString(),
      channels: data.channels ?? {},
      users: data.users ?? {},
      user_id_to_name: data.user_id_to_name ?? {},
    };
  } catch {
    return emptyMappings();
  }
}

export function saveMappings(mappings: Mappings): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  mappings.updated_at = new Date().toISOString();
  mappings.version = 1;
  fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings, null, 2) + "\n");
}

export function getChannelId(nameOrId: string): string | null {
  const value = nameOrId.trim();
  if (isChannelId(value)) return value;
  const mappings = loadMappings();
  return mappings.channels[normalizeChannelName(value)] ?? null;
}

export function setChannelMapping(name: string, channelId: string): void {
  const mappings = loadMappings();
  mappings.channels[normalizeChannelName(name)] = channelId;
  saveMappings(mappings);
}

export function getUserId(handleOrId: string): string | null {
  const value = handleOrId.trim();
  if (isUserId(value)) return value;
  const mappings = loadMappings();
  return mappings.users[normalizeUserHandle(value)] ?? null;
}

export function setUserMapping(handle: string, userId: string): void {
  const mappings = loadMappings();
  mappings.users[normalizeUserHandle(handle)] = userId;
  saveMappings(mappings);
}

export function getCachedDisplayName(userId: string): string | null {
  const mappings = loadMappings();
  return mappings.user_id_to_name[userId] ?? null;
}

export function setUserDisplayName(userId: string, displayName: string): void {
  const mappings = loadMappings();
  mappings.user_id_to_name[userId] = displayName;
  saveMappings(mappings);
}

export function upsertUserCache(
  updates: Array<{ id: string; handle?: string | null; display_name?: string | null }>,
): void {
  if (!updates.length) return;
  const mappings = loadMappings();
  for (const update of updates) {
    if (!update.id) continue;
    if (update.handle) {
      mappings.users[normalizeUserHandle(update.handle)] = update.id;
    }
    if (update.display_name) {
      mappings.user_id_to_name[update.id] = update.display_name;
    }
  }
  saveMappings(mappings);
}

export function clearMappings(): void {
  saveMappings(emptyMappings());
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function getUserDisplayName(user: Record<string, unknown>): string {
  const profile = (user["profile"] ?? {}) as Record<string, unknown>;
  return (
    ((profile["display_name"] as string) ?? "").trim() ||
    ((profile["real_name"] as string) ?? "").trim() ||
    ((user["real_name"] as string) ?? "").trim() ||
    ((user["name"] as string) ?? "").trim() ||
    ((user["id"] as string) ?? "unknown")
  );
}

export async function getUser(
  userId: string,
  cache?: boolean,
): Promise<Record<string, unknown>> {
  const result = await getClient().get("users.info", { user: userId });
  const user = (result["user"] ?? result) as Record<string, unknown>;

  const shouldCache = cache !== undefined ? cache : isCachingEnabled();
  if (shouldCache && user["id"]) {
    upsertUserCache([
      {
        id: user["id"] as string,
        handle: user["name"] as string | null,
        display_name: getUserDisplayName(user),
      },
    ]);
  }

  return user;
}

export async function listUsers(options: {
  includeBots?: boolean;
  limit?: number;
  cursor?: string;
  cache?: boolean;
} = {}): Promise<{ members: Record<string, unknown>[]; response_metadata: Record<string, unknown> }> {
  const { includeBots = false, limit = 200, cursor, cache } = options;

  const params: Record<string, string | number | boolean> = { limit };
  if (cursor) params["cursor"] = cursor;

  const result = await getClient().get("users.list", params);
  let members = (result["members"] ?? []) as Record<string, unknown>[];

  if (!includeBots) {
    members = members.filter((m) => !m["is_bot"] && m["id"] !== "USLACKBOT");
  }

  const shouldCache = cache !== undefined ? cache : isCachingEnabled();
  if (shouldCache && members.length) {
    upsertUserCache(
      members
        .filter((m) => m["id"])
        .map((m) => ({
          id: m["id"] as string,
          handle: (m["name"] as string) ?? null,
          display_name: getUserDisplayName(m),
        })),
    );
  }

  return {
    members,
    response_metadata: (result["response_metadata"] ?? {}) as Record<string, unknown>,
  };
}

export async function findUserByHandle(
  handle: string,
  options: {
    contains?: boolean;
    includeBots?: boolean;
    cache?: boolean;
  } = {},
): Promise<Record<string, unknown> | null> {
  const { contains = false, includeBots = false, cache } = options;
  const searchHandle = handle.trim().replace(/^@/, "").toLowerCase();
  const shouldCache = cache !== undefined ? cache : isCachingEnabled();

  if (!contains && shouldCache) {
    const cachedId = getUserId(searchHandle);
    if (cachedId) {
      try {
        return await getUser(cachedId, shouldCache);
      } catch {
        // Cache may be stale, fall through to API search
      }
    }
  }

  let cursor: string | undefined;
  while (true) {
    const result = await listUsers({ includeBots, cursor, cache: shouldCache });
    for (const member of result.members) {
      const memberHandle = ((member["name"] as string) ?? "").toLowerCase();
      if (contains ? memberHandle.includes(searchHandle) : memberHandle === searchHandle) {
        return member;
      }
    }
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor) break;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function listChannels(options: {
  types?: string;
  excludeArchived?: boolean;
  limit?: number;
  cursor?: string;
} = {}): Promise<{ channels: Record<string, unknown>[]; response_metadata: Record<string, unknown> }> {
  const {
    types = "public_channel,private_channel",
    excludeArchived = true,
    limit = 100,
    cursor,
  } = options;

  const params: Record<string, string | number | boolean> = {
    types,
    exclude_archived: excludeArchived,
    limit,
  };
  if (cursor) params["cursor"] = cursor;

  const result = await getClient().get("conversations.list", params);
  return {
    channels: (result["channels"] ?? []) as Record<string, unknown>[],
    response_metadata: (result["response_metadata"] ?? {}) as Record<string, unknown>,
  };
}

export async function getChannelInfo(
  channel: string,
  includeNumMembers = false,
): Promise<Record<string, unknown>> {
  const params: Record<string, string | number | boolean> = { channel };
  if (includeNumMembers) params["include_num_members"] = true;

  const result = await getClient().get("conversations.info", params);
  return (result["channel"] ?? result) as Record<string, unknown>;
}

export async function resolveChannel(
  channelInput: string,
): Promise<{ ok: boolean; channel?: Record<string, unknown>; method?: string; error?: string }> {
  const cleanInput = channelInput.trim().replace(/^#/, "");

  const cachedId = getChannelId(cleanInput);
  if (cachedId) {
    try {
      const info = await getChannelInfo(cachedId);
      if (info["id"]) return { ok: true, channel: info, method: "cache" };
    } catch {
      // fall through
    }
  }

  if (cleanInput.startsWith("C") && cleanInput.length >= 9) {
    try {
      const info = await getChannelInfo(cleanInput);
      if (info["id"]) return { ok: true, channel: info, method: "direct_lookup" };
    } catch {
      // fall through
    }
    return { ok: false, error: `Channel ID ${cleanInput} not found or not accessible` };
  }

  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const result = await listChannels({ limit: 200, cursor });
    for (const ch of result.channels) {
      if (((ch["name"] as string) ?? "").toLowerCase() === cleanInput.toLowerCase()) {
        setChannelMapping(ch["name"] as string, ch["id"] as string);
        return { ok: true, channel: ch, method: "conversations_list" };
      }
    }
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor) break;
  }

  return {
    ok: false,
    error: `Channel '${cleanInput}' not found. Try providing the channel ID directly (right-click channel in Slack → 'Copy link' → extract ID from URL).`,
  };
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

async function resolveUserNamesOnDemand(
  userIds: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const result: Record<string, string> = {};
  for (const userId of uniqueIds) {
    try {
      const user = await getUser(userId);
      result[userId] = getUserDisplayName(user);
    } catch {
      result[userId] = userId;
    }
  }
  return result;
}

export async function listMessages(options: {
  channel: string;
  limit?: number;
  cursor?: string;
  oldest?: string;
  latest?: string;
  inclusive?: boolean;
  resolveUsers?: boolean;
}): Promise<{
  messages: Record<string, unknown>[];
  has_more: boolean;
  response_metadata: Record<string, unknown>;
  user_names?: Record<string, string>;
}> {
  const {
    channel,
    limit = 100,
    cursor,
    oldest,
    latest,
    inclusive = true,
    resolveUsers = false,
  } = options;

  const params: Record<string, string | number | boolean> = {
    channel,
    limit,
    inclusive,
  };
  if (cursor) params["cursor"] = cursor;
  if (oldest) params["oldest"] = oldest;
  if (latest) params["latest"] = latest;

  const result = await getClient().get("conversations.history", params);
  const messages = (result["messages"] ?? []) as Record<string, unknown>[];

  const response: {
    messages: Record<string, unknown>[];
    has_more: boolean;
    response_metadata: Record<string, unknown>;
    user_names?: Record<string, string>;
  } = {
    messages,
    has_more: (result["has_more"] as boolean) ?? false,
    response_metadata: (result["response_metadata"] ?? {}) as Record<string, unknown>,
  };

  if (resolveUsers) {
    const userIds = messages.map((m) => m["user"] as string).filter(Boolean);
    response.user_names = await resolveUserNamesOnDemand(userIds);
  }

  return response;
}

export async function findUnansweredMessages(options: {
  channel: string;
  hoursOld?: number;
  maxResults?: number;
  resolveUsers?: boolean;
}): Promise<{
  messages: Record<string, unknown>[];
  total_checked: number;
  user_names?: Record<string, string>;
}> {
  const { channel, hoursOld = 48, maxResults = 50, resolveUsers = false } = options;

  const oldestTs = String(Date.now() / 1000 - hoursOld * 3600);
  const allMessages: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  let hasMore = true;

  while (hasMore && allMessages.length < maxResults * 3) {
    const result = await listMessages({
      channel,
      limit: 200,
      cursor,
      latest: oldestTs,
    });
    allMessages.push(...result.messages);
    hasMore = result.has_more;
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor) break;
  }

  const unanswered: Record<string, unknown>[] = [];
  for (const msg of allMessages) {
    if (msg["subtype"]) continue;
    if ((msg["reply_count"] as number) > 0) continue;
    const reactions = (msg["reactions"] as unknown[]) ?? [];
    if (reactions.length) continue;
    unanswered.push(msg);
    if (unanswered.length >= maxResults) break;
  }

  const response: {
    messages: Record<string, unknown>[];
    total_checked: number;
    user_names?: Record<string, string>;
  } = {
    messages: unanswered,
    total_checked: allMessages.length,
  };

  if (resolveUsers) {
    const userIds = unanswered.map((m) => m["user"] as string).filter(Boolean);
    response.user_names = await resolveUserNamesOnDemand(userIds);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Threads
// ---------------------------------------------------------------------------

export async function getThreadReplies(options: {
  channel: string;
  threadTs: string;
  limit?: number;
  cursor?: string;
  inclusive?: boolean;
  resolveUsers?: boolean;
}): Promise<{
  messages: Record<string, unknown>[];
  has_more: boolean;
  response_metadata: Record<string, unknown>;
  user_names?: Record<string, string>;
}> {
  const {
    channel,
    threadTs,
    limit = 200,
    cursor,
    inclusive = true,
    resolveUsers = false,
  } = options;

  const params: Record<string, string | number | boolean> = {
    channel,
    ts: threadTs,
    limit,
    inclusive,
  };
  if (cursor) params["cursor"] = cursor;

  const result = await getClient().get("conversations.replies", params);
  const messages = (result["messages"] ?? []) as Record<string, unknown>[];

  const response: {
    messages: Record<string, unknown>[];
    has_more: boolean;
    response_metadata: Record<string, unknown>;
    user_names?: Record<string, string>;
  } = {
    messages,
    has_more: (result["has_more"] as boolean) ?? false,
    response_metadata: (result["response_metadata"] ?? {}) as Record<string, unknown>,
  };

  if (resolveUsers) {
    const userIds = messages.map((m) => m["user"] as string).filter(Boolean);
    response.user_names = await resolveUserNamesOnDemand(userIds);
  }

  return response;
}

export async function getAllThreadReplies(options: {
  channel: string;
  threadTs: string;
  includeParent?: boolean;
  resolveUsers?: boolean;
}): Promise<{
  messages: Record<string, unknown>[];
  user_names?: Record<string, string>;
}> {
  const { channel, threadTs, includeParent = true, resolveUsers = false } = options;

  const allMessages: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  while (true) {
    const result = await getThreadReplies({ channel, threadTs, cursor });
    allMessages.push(...result.messages);
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor || !result.has_more) break;
  }

  allMessages.sort((a, b) => parseFloat(a["ts"] as string ?? "0") - parseFloat(b["ts"] as string ?? "0"));

  const filtered = includeParent
    ? allMessages
    : allMessages.filter((m) => m["ts"] !== threadTs);

  const response: {
    messages: Record<string, unknown>[];
    user_names?: Record<string, string>;
  } = { messages: filtered };

  if (resolveUsers) {
    const userIds = filtered.map((m) => m["user"] as string).filter(Boolean);
    response.user_names = await resolveUserNamesOnDemand(userIds);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function searchMessages(options: {
  query: string;
  count?: number;
  page?: number;
  sort?: string;
  sortDir?: string;
}): Promise<{
  matches: Record<string, unknown>[];
  total: number;
  pagination: Record<string, unknown>;
}> {
  const { query, count = 20, page = 1, sort = "timestamp", sortDir = "desc" } = options;

  const result = await getClient().get("search.messages", {
    query,
    count,
    page,
    sort,
    sort_dir: sortDir,
  });
  const messages = (result["messages"] ?? {}) as Record<string, unknown>;
  return {
    matches: (messages["matches"] ?? []) as Record<string, unknown>[],
    total: (messages["total"] as number) ?? 0,
    pagination: (messages["pagination"] ?? {}) as Record<string, unknown>,
  };
}

export async function searchFiles(options: {
  query: string;
  count?: number;
  page?: number;
  sort?: string;
  sortDir?: string;
}): Promise<{
  matches: Record<string, unknown>[];
  total: number;
  pagination: Record<string, unknown>;
}> {
  const { query, count = 20, page = 1, sort = "timestamp", sortDir = "desc" } = options;

  const result = await getClient().get("search.files", {
    query,
    count,
    page,
    sort,
    sort_dir: sortDir,
  });
  const files = (result["files"] ?? {}) as Record<string, unknown>;
  return {
    matches: (files["matches"] ?? []) as Record<string, unknown>[],
    total: (files["total"] as number) ?? 0,
    pagination: (files["pagination"] ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Links — URL parsing utilities
// ---------------------------------------------------------------------------

export interface SlackMessageLink {
  channelId: string;
  messageTs: string;
  threadTs: string | null;
  teamDomain: string;
}

export function parseSlackMessageLink(url: string): SlackMessageLink | null {
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith(".slack.com")) return null;

    const teamDomain = parsed.hostname.replace(".slack.com", "");
    const pathParts = parsed.pathname.replace(/^\//, "").split("/");

    if (pathParts.length < 3 || pathParts[0] !== "archives") return null;

    const channelId = pathParts[1];
    const messageSegment = pathParts[2];
    if (!messageSegment.startsWith("p")) return null;

    const messageId = messageSegment.slice(1);
    let messageTs: string;
    if (messageId.length > 10) {
      messageTs = `${messageId.slice(0, 10)}.${messageId.slice(10)}`;
    } else {
      messageTs = messageId;
    }

    const threadTs = parsed.searchParams.get("thread_ts");

    return { channelId, messageTs, threadTs, teamDomain };
  } catch {
    return null;
  }
}

export function buildSlackMessageUrl(
  teamDomain: string,
  channelId: string,
  messageTs: string,
  threadTs?: string,
): string {
  const messageId = "p" + messageTs.replace(".", "");
  let url = `https://${teamDomain}.slack.com/archives/${channelId}/${messageId}`;
  if (threadTs) {
    url += `?thread_ts=${threadTs}&cid=${channelId}`;
  }
  return url;
}

export function isSlackUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname.endsWith(".slack.com");
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Channel Summary
// ---------------------------------------------------------------------------

export interface ChannelSummary {
  channelId: string;
  channelName: string | null;
  date: string;
  messageCount: number;
  participantCount: number;
  topParticipants: Array<{ who: string; count: number }>;
  threadCount: number;
  totalReplies: number;
  messages: Record<string, unknown>[];
}

function dayWindowLocal(targetDate: string): [number, number] {
  const [year, month, day] = targetDate.split("-").map(Number);
  const start = new Date(year, month - 1, day, 0, 0, 0, 0).getTime() / 1000;
  const end = new Date(year, month - 1, day, 23, 59, 59, 999).getTime() / 1000;
  return [start, end];
}

async function resolveChannelForSummary(
  channel: string,
  includePrivate = false,
): Promise<string | null> {
  const cachedId = getChannelId(channel);
  if (cachedId) return cachedId;

  const target = channel.trim().replace(/^#/, "").toLowerCase();
  const types = includePrivate
    ? "public_channel,private_channel"
    : "public_channel";

  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const result = await listChannels({ types, cursor });
    for (const ch of result.channels) {
      if (((ch["name"] as string) ?? "").toLowerCase() === target) {
        setChannelMapping(ch["name"] as string, ch["id"] as string);
        return ch["id"] as string;
      }
    }
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor) break;
  }

  return null;
}

async function resolveUserNames(
  userIds: string[],
): Promise<Record<string, string>> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  const result: Record<string, string> = {};
  const cacheUpdates: Array<{ id: string; handle?: string | null; display_name?: string | null }> = [];

  for (const userId of uniqueIds) {
    const cached = getCachedDisplayName(userId);
    if (cached) {
      result[userId] = cached;
      continue;
    }
    try {
      const user = await getUser(userId);
      const displayName = getUserDisplayName(user);
      result[userId] = displayName;
      cacheUpdates.push({
        id: userId,
        handle: (user["name"] as string) ?? null,
        display_name: displayName,
      });
    } catch {
      result[userId] = userId;
    }
  }

  if (cacheUpdates.length) upsertUserCache(cacheUpdates);
  return result;
}

function computeTopParticipants(
  messages: Record<string, unknown>[],
  names?: Record<string, string>,
  limit = 15,
): Array<{ who: string; count: number }> {
  const counts: Record<string, number> = {};
  for (const msg of messages) {
    const actor =
      (msg["user"] as string) ||
      (msg["username"] as string) ||
      (msg["bot_id"] as string) ||
      "unknown";
    counts[actor] = (counts[actor] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([uid, count]) => ({
      who: names ? (names[uid] ?? uid) : uid,
      count,
    }));
}

function computeThreadStats(
  messages: Record<string, unknown>[],
): [number, number] {
  let threadCount = 0;
  let totalReplies = 0;
  for (const msg of messages) {
    const threadTs = msg["thread_ts"];
    const ts = msg["ts"];
    if (threadTs && threadTs === ts) {
      threadCount++;
      totalReplies += (msg["reply_count"] as number) ?? 0;
    }
  }
  return [threadCount, totalReplies];
}

export async function getChannelDaySummary(options: {
  channel: string;
  targetDate?: string;
  includeThreadReplies?: boolean;
  maxThreads?: number;
  includeBots?: boolean;
  resolveUsers?: boolean;
  includePrivate?: boolean;
}): Promise<ChannelSummary> {
  const {
    channel,
    targetDate,
    includeThreadReplies = false,
    maxThreads = 25,
    includeBots = false,
    resolveUsers: shouldResolveUsers = true,
    includePrivate = false,
  } = options;

  const channelId = await resolveChannelForSummary(channel, includePrivate);
  if (!channelId) throw new Error(`Could not resolve channel: ${channel}`);

  let channelName: string | null = null;
  try {
    const info = await getChannelInfo(channelId);
    channelName = (info["name"] as string) ?? null;
  } catch {
    // ignore
  }

  const date =
    targetDate ?? new Date().toISOString().slice(0, 10);
  const [oldest, latest] = dayWindowLocal(date);

  let allMessages: Record<string, unknown>[] = [];
  let cursor: string | undefined;

  for (let i = 0; i < 50; i++) {
    const result = await listMessages({
      channel: channelId,
      oldest: String(oldest),
      latest: String(latest),
      cursor,
    });
    allMessages.push(...result.messages);
    cursor = (result.response_metadata["next_cursor"] as string) || undefined;
    if (!cursor || !result.has_more) break;
  }

  if (!includeBots) {
    allMessages = allMessages.filter(
      (m) => !m["bot_id"] && m["subtype"] !== "bot_message",
    );
  }

  allMessages.sort(
    (a, b) =>
      parseFloat(a["ts"] as string ?? "0") -
      parseFloat(b["ts"] as string ?? "0"),
  );

  if (includeThreadReplies) {
    const threadRoots = allMessages
      .filter(
        (m) =>
          m["thread_ts"] === m["ts"] && (m["reply_count"] as number) > 0,
      )
      .slice(0, maxThreads);

    for (const root of threadRoots) {
      const repliesResult = await getAllThreadReplies({
        channel: channelId,
        threadTs: root["ts"] as string,
        includeParent: false,
      });
      let replies = repliesResult.messages;
      if (!includeBots) {
        replies = replies.filter(
          (r) => !r["bot_id"] && r["subtype"] !== "bot_message",
        );
      }
      allMessages.push(...replies);
    }

    allMessages.sort(
      (a, b) =>
        parseFloat(a["ts"] as string ?? "0") -
        parseFloat(b["ts"] as string ?? "0"),
    );
  }

  let names: Record<string, string> | undefined;
  if (shouldResolveUsers) {
    const userIds = allMessages
      .map((m) => m["user"] as string)
      .filter(Boolean);
    names = await resolveUserNames(userIds);
  }

  const [threadCount, totalReplies] = computeThreadStats(allMessages);
  const topParticipants = computeTopParticipants(allMessages, names);
  const uniqueParticipants = new Set(
    allMessages.map(
      (m) =>
        (m["user"] as string) ||
        (m["username"] as string) ||
        (m["bot_id"] as string) ||
        "unknown",
    ),
  );

  return {
    channelId,
    channelName,
    date,
    messageCount: allMessages.length,
    participantCount: uniqueParticipants.size,
    topParticipants,
    threadCount,
    totalReplies,
    messages: allMessages,
  };
}
