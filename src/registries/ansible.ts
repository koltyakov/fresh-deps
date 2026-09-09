import { fetchJson } from '../http';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';

const GALAXY = 'https://galaxy.ansible.com';
interface GalaxyPage {
  meta?: { count?: number }; count?: number;
  links?: { next?: string | null }; next?: string | null; next_link?: string | null;
  data?: { version?: string }[]; results?: { name?: string; version?: string }[];
}

export class AnsibleClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string, roles: boolean): Promise<RegistryVersions> {
    if (!/^[\w-]+\.[\w-]+$/.test(name)) return { error: 'invalid Galaxy name' };
    const [namespace, pkg] = name.split('.');
    let url: string;
    if (roles) {
      const result = await fetchJson<{ results?: { id?: number; name?: string; username?: string }[] }>(
        `${GALAXY}/api/v1/roles/?owner__username=${encodeURIComponent(namespace)}&name=${encodeURIComponent(pkg)}`, { timeoutMs: this.timeoutMs });
      const role = result?.results?.find((item) => item.name === pkg && item.username === namespace);
      if (!role || !Number.isSafeInteger(role.id) || role.id! <= 0) return { error: 'not found' };
      url = `${GALAXY}/api/v1/roles/${role.id}/versions/?page_size=100`;
    } else {
      url = `${GALAXY}/api/v3/plugin/ansible/content/published/collections/index/${encodeURIComponent(namespace)}/${encodeURIComponent(pkg)}/versions/?limit=100`;
    }
    const all: string[] = [];
    const visited = new Set<string>();
    let received = 0;
    for (let page = 0; page < 100; page++) {
      if (visited.has(url)) return { error: 'repeated Galaxy pagination link' };
      visited.add(url);
      const data = await fetchJson<GalaxyPage>(url, { timeoutMs: this.timeoutMs });
      if (!data) return { error: 'not found' };
      const entries = roles ? data.results : data.data;
      if (!Array.isArray(entries)) return { error: 'invalid Galaxy version response' };
      received += entries.length;
      for (const entry of entries) {
        const version = entry?.version ?? (entry as { name?: string } | null)?.name;
        if (typeof version === 'string' && semverScheme.isVersion(version)) all.push(version);
      }
      const next = roles ? data.next_link ?? data.next : data.links?.next;
      if (!next) {
        const count = roles ? data.count : data.meta?.count;
        if (typeof count === 'number' && received < count) return { error: 'incomplete Galaxy version listing' };
        return all.length ? { all: [...new Set(all)], latest: semverScheme.max(all, { includePrerelease: false }) }
          : { error: 'no comparable Galaxy versions found' };
      }
      if (typeof next !== 'string') return { error: 'invalid Galaxy pagination link' };
      const target = new URL(next, url);
      if (target.origin !== GALAXY || target.username || target.password || !target.pathname.startsWith('/api/')) return { error: 'invalid Galaxy pagination link' };
      url = target.href;
    }
    return { error: 'Galaxy version listing exceeded 100 pages' };
  }
}
