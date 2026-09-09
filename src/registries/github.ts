import { createHash } from 'crypto';
import { request, fetchJson } from '../http';

const pending = new Map<string, Promise<string[] | undefined>>();
const responses = new Map<string, { etag: string; tags: { name: string }[] }>();

export async function githubTagCommit(name: string, tag: string, timeoutMs: number): Promise<string | undefined> {
  let object = (await fetchJson<{ object?: { type?: string; sha?: string } }>(`https://api.github.com/repos/${name}/git/ref/tags/${encodeURIComponent(tag)}`, { timeoutMs }))?.object;
  for (let depth = 0; depth < 5 && object?.type === 'tag' && /^[a-f\d]{40}$/i.test(object.sha ?? ''); depth++) {
    object = (await fetchJson<{ object?: { type?: string; sha?: string } }>(`https://api.github.com/repos/${name}/git/tags/${object.sha}`, { timeoutMs }))?.object;
  }
  return object?.type === 'commit' && /^[a-f\d]{40}$/i.test(object.sha ?? '') ? object.sha : undefined;
}

/** Share raw tags across Actions and Swift; each caller applies its own version rules. */
export function githubTags(name: string, timeoutMs: number): Promise<string[] | undefined> {
  const token = process.env.FRESH_DEPS_GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';
  const key = `${name.toLowerCase()}|${createHash('sha256').update(token).digest('hex')}`;
  let promise = pending.get(key);
  if (!promise) {
    promise = load(key, name, timeoutMs).finally(() => pending.delete(key));
    pending.set(key, promise);
  }
  return promise;
}

async function load(key: string, name: string, timeoutMs: number): Promise<string[] | undefined> {
  const tags: string[] = [];
  for (let page = 1; page <= 10; page++) {
    const pageKey = `${key}|${page}`;
    const previous = responses.get(pageKey);
    const response = await request(`https://api.github.com/repos/${name}/tags?per_page=100&page=${page}`, {
      timeoutMs, headers: { 'X-GitHub-Api-Version': '2022-11-28', ...(previous ? { 'if-none-match': previous.etag } : {}) },
    }, 'application/vnd.github+json');
    if (!response) return undefined;
    const doc = response.status === 304 && previous ? previous.tags : await response.json() as { name: string }[];
    if (!Array.isArray(doc) || doc.some((tag) => !tag || typeof tag.name !== 'string')) throw new Error('invalid GitHub tags response');
    const etag = response.headers.get('etag');
    if (etag) {
      if (responses.size >= 1000) responses.delete(responses.keys().next().value!);
      responses.set(pageKey, { etag, tags: doc });
    }
    tags.push(...doc.map((tag) => tag.name));
    if (doc.length < 100) return tags;
  }
  throw new Error('GitHub tag pagination limit reached');
}
