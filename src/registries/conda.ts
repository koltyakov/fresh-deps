import { fetchJson } from '../http';
import { condaScheme } from '../numericVersion';
import type { RegistryVersions } from '../types';

export interface CondaPackage {
  files?: { version?: string; labels?: string[]; attrs?: { subdir?: string }; basename?: string }[];
}

export function condaSubdir(): string {
  const arch = process.arch === 'arm64' ? (process.platform === 'linux' ? 'aarch64' : 'arm64') : process.arch === 'x64' ? '64' : process.arch;
  return `${process.platform === 'darwin' ? 'osx' : process.platform === 'win32' ? 'win' : process.platform}-${arch}`;
}

export function condaVersions(doc: CondaPackage, subdir: string): RegistryVersions {
  if (!Array.isArray(doc.files)) return { error: 'invalid Conda package response' };
  const all = [...new Set(doc.files.flatMap((file) => {
    const platform = file.attrs?.subdir ?? file.basename?.split('/')[0];
    return file.version && condaScheme.isVersion(file.version) && (platform === subdir || platform === 'noarch')
      && (!file.labels || file.labels.includes('main')) ? [file.version] : [];
  }))];
  return all.length ? { all, latest: condaScheme.max(all, { includePrerelease: false }) } : { error: 'no comparable versions for this platform' };
}

export class CondaClient {
  constructor(private readonly timeoutMs: number, readonly subdir: string) {}
  async fetchVersions(name: string, channels: string): Promise<RegistryVersions> {
    for (const channel of channels.split('|')) {
      if (channel === 'defaults' || channel.startsWith('https://') || channel.includes('/label/')) {
        const bases = channel === 'defaults' ? ['https://repo.anaconda.com/pkgs/main', 'https://repo.anaconda.com/pkgs/r']
          : [channel.startsWith('https://') ? channel.replace(/\/$/, '') : `https://conda.anaconda.org/${channel}`];
        for (const base of bases) {
          const all: string[] = [];
          for (const subdir of [this.subdir, 'noarch']) {
            const doc = await fetchJson<{ packages?: Record<string, { name: string; version: string }>; 'packages.conda'?: Record<string, { name: string; version: string }> }>(`${base}/${subdir}/repodata.json`, { timeoutMs: this.timeoutMs });
            for (const pkg of [...Object.values(doc?.packages ?? {}), ...Object.values(doc?.['packages.conda'] ?? {})]) {
              if (pkg.name === name && condaScheme.isVersion(pkg.version)) all.push(pkg.version);
            }
          }
          if (all.length) return { all: [...new Set(all)], latest: condaScheme.max(all, { includePrerelease: false }) };
        }
        continue;
      }
      const doc = await fetchJson<CondaPackage>(`https://api.anaconda.org/package/${encodeURIComponent(channel)}/${encodeURIComponent(name)}`,
        { timeoutMs: this.timeoutMs });
      if (!doc) continue;
      if (!Array.isArray(doc.files)) return { error: 'invalid Conda package response' };
      const result = condaVersions(doc, this.subdir);
      // Strict channel priority applies to packages available for this platform.
      if (result.all?.length || doc.files.some((file) => [this.subdir, 'noarch'].includes(file.attrs?.subdir ?? file.basename?.split('/')[0] ?? '')
        && (!file.labels || file.labels.includes('main')))) return result;
    }
    return { error: 'not found' };
  }
}
