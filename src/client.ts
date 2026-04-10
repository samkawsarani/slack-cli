import * as path from "path";
import * as os from "os";
import { config as dotenvConfig } from "dotenv";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "slack");
export const CONFIG_ENV = path.join(CONFIG_DIR, ".env");

const BASE_URL = "https://slack.com/api";
const MAX_RETRIES = 3;

export function loadConfig(): void {
  dotenvConfig({ path: CONFIG_ENV });
  dotenvConfig({ path: path.join(process.cwd(), ".env"), override: true });
}

loadConfig();

export class APIError extends Error {
  constructor(
    public readonly statusCode: number | null,
    message: string,
    public readonly response?: unknown,
  ) {
    super(message);
    this.name = "APIError";
  }
}

function getToken(): string {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) {
    throw new Error(
      "SLACK_USER_TOKEN not set. Run `slack init` to configure.",
    );
  }
  return token;
}

export class SlackClient {
  private readonly token: string;

  constructor(token?: string) {
    this.token = token ?? getToken();
  }

  async get(
    endpoint: string,
    params?: Record<string, string | number | boolean>,
  ): Promise<Record<string, unknown>> {
    return this._requestWithRetry("GET", endpoint, params);
  }

  async post(
    endpoint: string,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this._requestWithRetry("POST", endpoint, undefined, data);
  }

  private async _requestWithRetry(
    method: string,
    endpoint: string,
    params?: Record<string, string | number | boolean>,
    data?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let url = `${BASE_URL}/${endpoint}`;

      if (method === "GET" && params) {
        const qs = new URLSearchParams();
        for (const [k, v] of Object.entries(params)) {
          qs.set(k, String(v));
        }
        url += `?${qs.toString()}`;
      }

      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json; charset=utf-8",
        },
        signal: AbortSignal.timeout(30_000),
      };

      if (method === "POST") {
        init.body = JSON.stringify(data ?? {});
      }

      const response = await fetch(url, init);

      if (response.status === 429) {
        if (attempt === MAX_RETRIES) {
          throw new APIError(
            429,
            `Slack API rate limited after ${MAX_RETRIES} retries`,
          );
        }
        const retryAfter = parseFloat(
          response.headers.get("Retry-After") ?? "1",
        );
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        continue;
      }

      return this._handleResponse(response);
    }

    throw new APIError(null, `Slack API request failed after ${MAX_RETRIES} retries`);
  }

  private async _handleResponse(
    response: Response,
  ): Promise<Record<string, unknown>> {
    if (!response.ok) {
      const text = await response.text();
      throw new APIError(
        response.status,
        `Slack API request failed: ${response.status}`,
        text,
      );
    }

    const data = (await response.json()) as Record<string, unknown>;

    if (!data["ok"]) {
      const error = (data["error"] as string) ?? "Unknown error";
      throw new APIError(null, `Slack API error: ${error}`, data);
    }

    return data;
  }
}

let _client: SlackClient | null = null;

export function getClient(): SlackClient {
  if (!_client) {
    _client = new SlackClient();
  }
  return _client;
}

export function _setClient(client: SlackClient | null): void {
  _client = client;
}
