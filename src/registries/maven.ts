import { fetchText } from '../http';
import * as mavenVersion from '../mavenVersion';
import type { RegistryVersions } from '../types';

const DEFAULT_REPOSITORY = 'https://repo.maven.apache.org/maven2';

export class MavenClient {
  readonly repository: string;

  constructor(repositoryOverride: string, private readonly timeoutMs: number) {
    this.repository = (repositoryOverride || DEFAULT_REPOSITORY).replace(/\/+$/, '');
  }

  async fetchVersions(coordinate: string): Promise<RegistryVersions> {
    const [groupId, artifactId] = coordinate.split(':');
    if (!groupId || !artifactId) return { error: 'invalid Maven coordinate' };
    const groupPath = groupId.split('.').map(encodeURIComponent).join('/');
    const url = `${this.repository}/${groupPath}/${encodeURIComponent(artifactId)}/maven-metadata.xml`;
    const xml = await fetchText(url, { timeoutMs: this.timeoutMs });
    return xml ? versionsFromMetadata(xml) : { error: 'not found' };
  }
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

export function versionsFromMetadata(xml: string): RegistryVersions {
  const all = [...xml.matchAll(/<version>\s*([^<]+?)\s*<\/version>/g)]
    .map((match) => decodeXml(match[1].trim()))
    .filter(mavenVersion.isValid);
  const declaredRelease = xml.match(/<release>\s*([^<]+?)\s*<\/release>/)?.[1];
  const release = declaredRelease ? decodeXml(declaredRelease.trim()) : undefined;
  const latest = release && mavenVersion.isValid(release) && !mavenVersion.isPrerelease(release)
    ? release
    : mavenVersion.max(all, { includePrerelease: false });
  return latest || all.length ? { ...(latest ? { latest } : {}), all } : { error: 'no comparable versions found' };
}
