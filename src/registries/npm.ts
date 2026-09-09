import * as semver from 'semver';
import { fetchJson, HttpError, type RequestOptions } from '../http';
import { authHeaderFor, readNpmConfig, type NpmConfig } from '../npmrc';
import type { AuditResponse, PackageMeta, RegistryVersions, SecurityAdvisory } from '../types';

const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
/** Abbreviated metadata: same version list, a fraction of the payload. */
const ABBREVIATED = 'application/vnd.npm.install-v1+json;q=1.0, application/json;q=0.8, */*';

/** The `latest` document, which is a full version document plus npm's own fields. */
interface VersionDocument {
  version?: string;
  description?: string;
  license?: unknown;
  deprecated?: string;
  homepage?: string;
  repository?: unknown;
  _npmUser?: { name?: string };
  dist?: { unpackedSize?: number; fileCount?: number };
  engines?: { node?: string };
}

interface Packument {
  'dist-tags'?: Record<string, string>;
  versions?: Record<string, VersionDocument>;
}

/** The full packument, the only place the registry publishes per-version dates. */
interface DatedPackument {
  time?: Record<string, string>;
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
    const body = await fetchJson<VersionDocument>(url, this.requestOptions(name));
    if (!body?.version) {
      return { error: 'not found' };
    }
    // The document describing the newest release is already on the wire, so the
    // descriptive fields on it are free - only the publish date is missing.
    return { latest: body.version, meta: metaOf(body), ...(body.engines?.node ? { requirements: { [body.version]: [body.engines.node] } } : {}) };
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
      requirements: Object.fromEntries(Object.entries(body.versions ?? {}).map(([version, doc]) => [version, [doc.engines?.node ?? '']])),
    };
  }

  /**
   * Publish dates for specific versions. Only the unabbreviated packument carries
   * the `time` map, and for a long-lived package that document runs to megabytes,
   * so this is never part of a normal check - it is fetched when someone actually
   * asks to see the dates, and answers for every version at once.
   */
  async fetchPublishDates(name: string, versions: string[]): Promise<Map<string, string>> {
    const url = `${this.registryFor(name)}/${encodeName(name)}`;
    const body = await fetchJson<DatedPackument>(url, this.requestOptions(name));
    const dates = new Map<string, string>();
    for (const version of versions) {
      const published = body?.time?.[version];
      if (published) {
        dates.set(version, published);
      }
    }
    return dates;
  }

  async fetchAudit(name: string, version: string): Promise<AuditResponse> {
    if (!semver.valid(version)) {
      throw new Error('Invalid npm audit version');
    }
    const request = this.requestOptions(name);
    let body: unknown;
    try {
      body = await fetchJson<unknown>(`${this.registryFor(name)}/-/npm/v1/security/advisories/bulk`, {
        ...request,
        method: 'POST',
        body: JSON.stringify({ [name]: [version] }),
        headers: { ...request.headers, 'content-type': 'application/json' },
      });
    } catch (error) {
      if (error instanceof HttpError && (error.status === 405 || error.status === 501)) {
        return { status: 'unsupported' };
      }
      throw error;
    }
    if (body === undefined) {
      return { status: 'unsupported' };
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Malformed npm audit response');
    }
    const advisories: SecurityAdvisory[] = [];
    for (const [packageName, entries] of Object.entries(body)) {
      if (!Array.isArray(entries)) {
        throw new Error('Malformed npm audit response');
      }
      for (const entry of entries) {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
            !((typeof entry.id === 'string' && entry.id.trim()) ||
              (typeof entry.id === 'number' && Number.isSafeInteger(entry.id))) ||
            typeof entry.title !== 'string' || !entry.title.trim() ||
            typeof entry.vulnerable_versions !== 'string' || !entry.vulnerable_versions.trim() ||
            semver.validRange(entry.vulnerable_versions, { includePrerelease: true }) === null ||
            (entry.severity !== undefined && typeof entry.severity !== 'string') ||
            (entry.url !== undefined && typeof entry.url !== 'string')) {
          throw new Error('Malformed npm audit advisory');
        }
        if (packageName === name && semver.satisfies(version, entry.vulnerable_versions, { includePrerelease: true })) {
          advisories.push({
            id: String(entry.id),
            title: entry.title,
            ...(entry.severity !== undefined ? { severity: entry.severity } : {}),
            ...(entry.url !== undefined ? { url: entry.url } : {}),
          });
        }
      }
    }
    return { status: 'checked', advisories };
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
    const authorization = authHeaderFor(this.config, this.registryFor(name));
    const headers: Record<string, string> = {};
    if (authorization) {
      headers.authorization = authorization;
    }
    return { timeoutMs: this.options.timeoutMs, headers };
  }
}

/** Picks the presentable fields out of a version document, dropping empty ones. */
export function metaOf(doc: VersionDocument): PackageMeta {
  const meta: PackageMeta = {};
  if (doc.description) {
    meta.description = doc.description;
  }
  // Old packages spell the license as an object, or as a list of them.
  const license = licenseOf(doc.license);
  if (license) {
    meta.license = license;
  }
  if (doc.deprecated) {
    meta.deprecated = doc.deprecated;
  }
  if (doc._npmUser?.name) {
    meta.publisher = doc._npmUser.name;
  }
  if (doc.homepage) {
    meta.homepage = doc.homepage;
  }
  const repository = repositoryOf(doc.repository);
  if (repository) {
    meta.repository = repository;
  }
  if (typeof doc.dist?.unpackedSize === 'number') {
    meta.unpackedSize = doc.dist.unpackedSize;
  }
  if (typeof doc.dist?.fileCount === 'number') {
    meta.fileCount = doc.dist.fileCount;
  }
  return meta;
}

function licenseOf(license: unknown): string | undefined {
  if (typeof license === 'string') {
    return license;
  }
  if (Array.isArray(license)) {
    return license.map(licenseOf).filter(Boolean).join(', ') || undefined;
  }
  if (license && typeof license === 'object' && 'type' in license) {
    const type = (license as { type?: unknown }).type;
    return typeof type === 'string' ? type : undefined;
  }
  return undefined;
}

/** Turns the `git+ssh://…` forms npm accepts into something a browser can open. */
export function repositoryOf(repository: unknown): string | undefined {
  const raw =
    typeof repository === 'string'
      ? repository
      : repository && typeof repository === 'object' && 'url' in repository
        ? (repository as { url?: unknown }).url
        : undefined;
  if (typeof raw !== 'string' || raw === '') {
    return undefined;
  }
  const url = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^ssh:\/\/git@/, 'https://')
    .replace(/^git@([^:]+):/, 'https://$1/')
    .replace(/\.git$/, '');
  return url.startsWith('http') ? url : undefined;
}

function encodeName(name: string): string {
  return name.startsWith('@') ? name.replace('/', '%2f') : encodeURIComponent(name);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
