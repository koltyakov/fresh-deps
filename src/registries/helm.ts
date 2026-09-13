import { isMap, isScalar, isSeq } from 'yaml';
import { fetchText } from '../http';
import { yamlDocument, yamlString } from '../parsers/yaml';
import { semverScheme } from '../schemes';
import type { RegistryVersions } from '../types';
import { OciClient } from './oci';

export function helmVersions(text: string, name: string): RegistryVersions {
  const entries = yamlDocument(text)?.root.get('entries', true);
  const releases = isMap(entries) ? entries.get(name, true) : undefined;
  if (!isSeq(releases)) return { error: 'not found' };
  const published = releases.items.flatMap((entry) => {
    const version = isMap(entry) ? yamlString(entry.get('version', true)) : undefined;
    return version && semverScheme.isVersion(version) ? [version] : [];
  });
  const all = releases.items.flatMap((entry) => {
    if (!isMap(entry)) return [];
    const version = yamlString(entry.get('version', true));
    const removed = entry.get('removed', true);
    return version && semverScheme.isVersion(version) && !(isScalar(removed) && removed.value === true) ? [version] : [];
  });
  return { all, published, allComplete: releases.items.every((entry) => isMap(entry) && !!yamlString(entry.get('version', true))), latest: semverScheme.max(all, { includePrerelease: false }) };
}

export class HelmClient {
  private readonly indexes = new Map<string, Promise<string | undefined>>();
  constructor(private readonly timeoutMs: number) {}
  async fetchVersions(name: string, source: string): Promise<RegistryVersions> {
    if (source.startsWith('oci://')) {
      const url = new URL(source);
      const tags = await new OciClient(this.timeoutMs).tags(url.host, `${url.pathname.replace(/^\//, '')}/${name}`.replace(/^\//, ''));
      if (!tags) return { error: 'not found' };
      const all = tags.map((tag) => tag.replace(/_/g, '+')).filter((tag) => semverScheme.isVersion(tag));
      return { all, allComplete: true, latest: semverScheme.max(all, { includePrerelease: false }) };
    }
    let index = this.indexes.get(source);
    if (!index) {
      index = fetchText(`${source}/index.yaml`, { timeoutMs: this.timeoutMs, headers: { accept: 'application/yaml, text/yaml, text/plain' } });
      this.indexes.set(source, index);
    }
    const text = await index;
    return text ? helmVersions(text, name) : { error: 'not found' };
  }
}
