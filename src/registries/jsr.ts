import { fetchJson } from '../http';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';

export interface JsrPackage { latest?: string; versions?: Record<string, { yanked?: boolean }> }

export function jsrVersions(doc: JsrPackage): RegistryVersions {
  if (!doc.versions || typeof doc.versions !== 'object' || Array.isArray(doc.versions)) return { error: 'no comparable versions found' };
  const all = Object.entries(doc.versions ?? {}).filter(([version, info]) => semverScheme.isVersion(version) && !info?.yanked)
    .map(([version]) => version);
  const latest = doc.latest && all.includes(doc.latest) && !semverScheme.isPrerelease(doc.latest)
    ? doc.latest : semverScheme.max(all, { includePrerelease: false });
  return { latest, all, published: Object.keys(doc.versions ?? {}).filter(semverScheme.isVersion),
    allComplete: !!doc.versions && typeof doc.versions === 'object' && !Array.isArray(doc.versions) };
}

export class JsrClient {
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string): Promise<RegistryVersions> {
    const doc = await fetchJson<JsrPackage>(`https://jsr.io/${name}/meta.json`, { timeoutMs: this.timeoutMs });
    return doc ? jsrVersions(doc) : { error: 'not found' };
  }
}
