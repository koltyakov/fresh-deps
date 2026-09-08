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
  const response = await request(url, options, 'application/json');
  return (await response?.json()) as T | undefined;
}

export async function fetchText(url: string, options: RequestOptions): Promise<string | undefined> {
  const response = await request(url, options, 'application/xml, text/xml');
  return response?.text();
}

async function request(url: string, options: RequestOptions, accept: string): Promise<Response | undefined> {
  const response = await fetch(url, {
    headers: {
      accept,
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
  return response;
}
