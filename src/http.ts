export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly retryAt?: number) {
    super(message);
  }
}

export interface RequestOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
  method?: 'POST';
  body?: string;
}

/**
 * Fetches JSON. Returns undefined for 404 so callers can treat "unknown package"
 * as a normal outcome rather than an error.
 */
export async function fetchJson<T>(url: string, options: RequestOptions): Promise<T | undefined> {
  const response = await request(url, options, 'application/json');
  return (await response?.json()) as T | undefined;
}

export async function fetchText(url: string, options: RequestOptions): Promise<string | undefined> {
  const response = await request(url, options, 'application/xml, text/xml');
  return response?.text();
}

const cooldowns = new Map<string, number>();

export async function request(url: string, options: RequestOptions, accept: string): Promise<Response | undefined> {
  const origin = new URL(url).origin;
  const retryAt = cooldowns.get(origin);
  if (retryAt && retryAt > Date.now()) throw new HttpError(429, `Registry rate limited until ${new Date(retryAt).toISOString()}`, retryAt);
  const githubToken = origin === 'https://api.github.com' ? process.env.FRESH_DEPS_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN : undefined;
  const response = await fetch(url, {
    ...(options.method ? { method: options.method } : {}),
    ...(options.body !== undefined ? { body: options.body } : {}),
    headers: {
      accept,
      'user-agent': 'vscode-fresh-deps',
      ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {}),
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (response.status === 404 || response.status === 410) {
    return undefined;
  }
  if (!response.ok && response.status !== 304) {
    const after = response.headers.get('retry-after');
    const reset = response.headers.get('x-ratelimit-reset');
    const until = after ? (/^\d+$/.test(after) ? Date.now() + Number(after) * 1000 : Date.parse(after))
      : response.headers.get('x-ratelimit-remaining') === '0' && reset ? Number(reset) * 1000 : undefined;
    if ((response.status === 403 || response.status === 429) && until && Number.isFinite(until)) cooldowns.set(origin, until);
    throw new HttpError(response.status, `${response.status} ${response.statusText}${until && Number.isFinite(until) ? `; retry after ${new Date(until).toISOString()}` : ''}`, until);
  }
  return response;
}
