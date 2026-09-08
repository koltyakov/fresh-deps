import { fetchJson, type RequestOptions } from '../http';
import { authTokenFor, readNpmConfig, type NpmConfig } from '../npmrc';
import type { RegistryVersions } from '../types';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
/** Abbreviated metadata: same version list, a fraction of the payload. */
const ABBREVIATED = 'application/vnd.npm.install-v1+json;q=1.0, application/json;q=0.8, */*';

interface PackumentLatest {
  version?: string;
}

interface Packument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, unknown>;
}

export interface NpmClientOptions {
  /** Overrides every registry lookup when set. */
  registryOverride?: string;
  /** Directory the manifest lives in, used to locate .npmrc files. */
  cwd: string;
  timeoutMs: number;
}

export class NpmClient {
  private readonly config: NpmConfig;

  constructor(private readonly options: NpmClientOptions) {
    this.config = readNpmConfig(options.cwd);
  }

  /** Cheap lookup: just the version behind the `latest` dist-tag. */
  async fetchLatest(name: string): Promise<RegistryVersions> {
    const url = `${this.registryFor(name)}/${encodeName(name)}/latest`;
    const body = await fetchJson<PackumentLatest>(url, this.requestOptions(name));
    return body?.version ? { latest: body.version } : { error: 'not found' };
  }

  /** Full lookup: every published version, for finding the newest in-range one. */
  async fetchAll(name: string): Promise<RegistryVersions> {
    const url = `${this.registryFor(name)}/${encodeName(name)}`;
    const request = this.requestOptions(name);
    const body = await fetchJson<Packument>(url, {
      ...request,
      headers: { ...request.headers, accept: ABBREVIATED },
    });
    if (!body) {
      return { error: 'not found' };
    }
    return {
      ...(body['dist-tags']?.latest ? { latest: body['dist-tags'].latest } : {}),
      all: Object.keys(body.versions ?? {}),
    };
  }

  /** Registry a package resolves to, also used as part of its cache key. */
  registryFor(name: string): string {
    if (this.options.registryOverride) {
      return trimSlash(this.options.registryOverride);
    }
    const scope = name.startsWith('@') ? name.slice(0, name.indexOf('/')) : undefined;
    const scoped = scope ? this.config.get(`${scope}:registry`) : undefined;
    return trimSlash(scoped ?? this.config.get('registry') ?? DEFAULT_REGISTRY);
  }

  private requestOptions(name: string): RequestOptions {
    const token = authTokenFor(this.config, this.registryFor(name));
    const headers: Record<string, string> = {};
    if (token) {
      headers.authorization = `Bearer ${token}`;
    }
    return { timeoutMs: this.options.timeoutMs, headers };
  }
}

function encodeName(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
