import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { HttpError } from '../http';

export function basicAuth(host: string): string | undefined {
  try {
    const config = JSON.parse(readFileSync(join(process.env.DOCKER_CONFIG || join(homedir(), '.docker'), 'config.json'), 'utf8'));
    const auth = config.auths?.[host]?.auth ?? (host === 'registry-1.docker.io' ? config.auths?.['https://index.docker.io/v1/']?.auth : undefined);
    return typeof auth === 'string' && /^[A-Za-z\d+/=]+$/.test(auth) ? `Basic ${auth}` : undefined;
  } catch { return undefined; }
}

/** OCI Distribution tag listing, shared by images and Helm charts. */
export class OciClient {
  private readonly tokens = new Map<string, string>();
  constructor(private readonly timeoutMs: number) {}

  async response(url: string, accept = 'application/json'): Promise<Response | undefined> {
    const target = new URL(url);
    if (target.protocol !== 'https:' || target.username || target.password) throw new Error('OCI registry must use HTTPS');
    const basic = basicAuth(target.host);
    const fetchWith = (authorization?: string) => fetch(url, {
      headers: { accept, 'user-agent': 'vscode-fresh-deps', ...(authorization ? { authorization } : {}) },
      signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
    });
    let response = await fetchWith(this.tokens.get(target.origin) ?? basic);
    if (response.status === 401) {
      const challenge = response.headers.get('www-authenticate') ?? '';
      if (!/^Bearer\s/i.test(challenge)) throw new HttpError(401, 'OCI registry authentication required');
      const fields = new Map([...challenge.matchAll(/(\w+)="([^"]*)"/g)].map((match) => [match[1].toLowerCase(), match[2]]));
      const realm = new URL(fields.get('realm') ?? '');
      if (realm.protocol !== 'https:' || realm.username || realm.password) throw new Error('Invalid OCI token realm');
      for (const key of ['service', 'scope']) if (fields.has(key)) realm.searchParams.set(key, fields.get(key)!);
      const tokenResponse = await fetch(realm.href, {
        headers: { accept: 'application/json', ...((realm.origin === target.origin || target.hostname === 'registry-1.docker.io' && realm.origin === 'https://auth.docker.io') && basic ? { authorization: basic } : {}) },
        signal: AbortSignal.timeout(this.timeoutMs), redirect: 'error',
      });
      if (!tokenResponse.ok) throw new HttpError(tokenResponse.status, 'OCI token request failed');
      const tokenDoc = await tokenResponse.json() as { token?: string; access_token?: string };
      const token = tokenDoc.token ?? tokenDoc.access_token;
      if (typeof token !== 'string' || !token) throw new Error('OCI registry did not return a token');
      this.tokens.set(target.origin, `Bearer ${token}`);
      response = await fetchWith(`Bearer ${token}`);
    }
    if (response.status === 404) return undefined;
    if (!response.ok) throw new HttpError(response.status, `OCI registry: ${response.status} ${response.statusText}`);
    return response;
  }

  async tags(host: string, name: string): Promise<string[] | undefined> {
    if (!/^[a-zA-Z\d.-]+(?::\d+)?$/.test(host) || !/^[\w.-]+(?:\/[\w.-]+)*$/.test(name)) throw new Error('Invalid OCI repository');
    const base = new URL(`https://${host}/v2/${name}/tags/list`);
    let url = `${base.href}?n=1000`;
    const tags: string[] = [];
    for (let page = 0; page < 100; page++) {
      const response = await this.response(url);
      if (!response) return undefined;
      const body = await response.json() as { tags?: string[] | null };
      if (body.tags !== null && (!Array.isArray(body.tags) || body.tags.some((tag) => typeof tag !== 'string'))) throw new Error('Invalid OCI tag response');
      tags.push(...body.tags ?? []);
      const link = response.headers.get('link');
      if (!link) return tags;
      const href = /<([^>]+)>\s*;\s*rel="?next"?/.exec(link)?.[1];
      if (!href) throw new Error('Invalid OCI pagination link');
      const next = new URL(href, url);
      if (next.origin !== base.origin || next.pathname !== base.pathname || next.username || next.password) throw new Error('Unexpected OCI pagination URL');
      url = next.href;
    }
    throw new Error('OCI tag pagination limit reached');
  }
}
