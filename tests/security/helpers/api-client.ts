import { readFileSync } from "node:fs";

/**
 * Minimal cookie-aware HTTP client for security tests against a running server
 * (E2E_BASE_URL, default http://localhost:3000). Each client is one browser-like
 * session: cookies are kept across calls.
 */
export class ApiClient {
  private cookies = new Map<string, string>();

  constructor(
    readonly baseUrl: string,
    readonly origin: string = baseUrl,
  ) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private storeCookies(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const idx = pair?.indexOf("=") ?? -1;
      if (pair && idx > 0) {
        const name = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (header.toLowerCase().includes("max-age=0") || value === "") this.cookies.delete(name);
        else this.cookies.set(name, value);
      }
    }
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { origin?: string | null; headers?: Record<string, string> } = {},
  ): Promise<{ status: number; json: unknown; response: Response }> {
    const headers: Record<string, string> = { ...options.headers };
    if (body !== undefined) headers["content-type"] = "application/json";
    const origin = options.origin === undefined ? this.origin : options.origin;
    if (origin) headers.origin = origin;
    const cookie = this.cookieHeader();
    if (cookie) headers.cookie = cookie;
    const init: RequestInit = { method, headers, redirect: "manual" };
    if (body !== undefined) init.body = JSON.stringify(body);
    const response = await fetch(`${this.baseUrl}${path}`, init);
    this.storeCookies(response);
    const text = await response.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    return { status: response.status, json, response };
  }

  get(path: string) {
    return this.request("GET", path);
  }
  post(path: string, body?: unknown, options?: { origin?: string | null }) {
    return this.request("POST", path, body ?? {}, options);
  }
  patch(path: string, body: unknown) {
    return this.request("PATCH", path, body);
  }
  put(path: string, body: unknown) {
    return this.request("PUT", path, body);
  }
  delete(path: string) {
    return this.request("DELETE", path);
  }
}

/** Read the file e-mail outbox (EMAIL_PROVIDER=file) and return the last link matching `pattern` for `to`. */
export function lastEmailLink(outboxPath: string, to: string, pattern: RegExp): string {
  const lines = readFileSync(outboxPath, "utf8").split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const record = JSON.parse(lines[i]!) as { to: string; text: string };
    if (record.to === to) {
      const match = record.text.match(pattern);
      if (match?.[0]) return match[0];
    }
  }
  throw new Error(`Aucun e-mail correspondant pour ${to}`);
}

/** Sign up + verify (via the file outbox) + sign in. Returns a session-bearing client. */
export async function signedInClient(
  baseUrl: string,
  outboxPath: string,
  user: { name: string; email: string; password: string },
): Promise<ApiClient> {
  const client = new ApiClient(baseUrl);
  const signup = await client.post("/api/auth/sign-up/email", user);
  if (signup.status !== 200) throw new Error(`Inscription échouée (${signup.status}): ${JSON.stringify(signup.json)}`);
  const link = lastEmailLink(outboxPath, user.email, /https?:\/\/\S+verify-email\S+/);
  const url = new URL(link);
  await client.request("GET", `${url.pathname}${url.search}`);
  const signin = await client.post("/api/auth/sign-in/email", { email: user.email, password: user.password });
  if (signin.status !== 200) throw new Error(`Connexion échouée (${signin.status}): ${JSON.stringify(signin.json)}`);
  return client;
}
