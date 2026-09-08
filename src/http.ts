export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export interface RequestOptions {
  timeoutMs: number;
  headers?: Record<string, string>;
}

/**
 * Fetches JSON. Returns undefined for 404 so callers can treat "unknown package"
 * as a normal outcome rather than an error.
 */
export async function fetchJson<T>(url: string, options: RequestOptions): Promise<T | undefined> {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'vscode-fresh-deps',
      ...options.headers,
    },
    signal: AbortSignal.timeout(options.timeoutMs),
  });

  if (response.status === 404 || response.status === 410) {
    return undefined;
  }
  if (!response.ok) {
    throw new HttpError(response.status, `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}
