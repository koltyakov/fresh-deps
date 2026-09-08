import { fetchJson, HttpError } from '../http';
import * as pep440 from '../pep440';
import { readPipConfig, resolveIndexUrl, splitCredentials } from '../pipconf';
import type { AuditResponse, PackageMeta, RegistryVersions, SecurityAdvisory } from '../types';

/** PEP 691 JSON, which carries the version list PEP 700 added. */
const SIMPLE_JSON = 'application/vnd.pypi.simple.v1+json;q=1.0, application/json;q=0.8, */*;q=0.1';

const ARCHIVE_RE = /\.(?:tar\.gz|tar\.bz2|tar\.xz|tgz|zip)$/i;

interface SimpleFile {
  filename?: string;
  /** PEP 592: `true`, or a string giving the reason. */
  yanked?: boolean | string;
  /** PEP 700, so every version the index lists arrives already dated. */
  'upload-time'?: string;
}

interface SimpleProject {
  versions?: string[];
  files?: SimpleFile[];
}

export interface PyPiClientOptions {
  /** Overrides the index when set; empty falls back to pip's own configuration. */
  indexOverride?: string;
  timeoutMs: number;
}

export class PyPiClient {
  /** Resolved index base URL, also part of the cache key. */
  readonly index: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly options: PyPiClientOptions) {
    const { url, auth } = splitCredentials(resolveIndexUrl(options.indexOverride, readPipConfig()));
    this.index = url;
    this.headers = { accept: SIMPLE_JSON, ...(auth ? { authorization: auth } : {}) };
  }

  /**
   * The simple index answers with every version in one response, so unlike npm
   * there is no cheaper "just the latest" call to make first.
   */
  async fetchVersions(name: string): Promise<RegistryVersions> {
    const url = `${this.index}/${normalizeName(name)}/`;
    const body = await fetchJson<SimpleProject>(url, { timeoutMs: this.options.timeoutMs, headers: this.headers });
    if (!body) {
      return { error: 'not found' };
    }

    const files = body.files ?? [];
    const withdrawn = yankedVersions(files);
    const published = (body.versions ?? derivedVersions(files)).filter((version) => {
      const parsed = pep440.parseVersion(version);
      return parsed !== undefined && !withdrawn.has(parsed.text);
    });

    if (published.length === 0) {
      return { error: 'no releases' };
    }

    // Prereleases stay out of `latest` the way pip resolves; they are still in
    // `all` for anyone who opted into them.
    const latest = pep440.max(published, { includePrerelease: false });
    const latestPublishedAt = latest ? uploadTimes(files).get(latest) : undefined;
    return {
      ...(latest ? { latest } : {}),
      all: published,
      ...(latestPublishedAt ? { meta: { latestPublishedAt } } : {}),
    };
  }

  /**
   * Publish dates come off the same listing the versions did, so this costs one
   * request no matter how many versions are asked about.
   */
  async fetchPublishDates(name: string, versions: string[]): Promise<Map<string, string>> {
    const url = `${this.index}/${normalizeName(name)}/`;
    const body = await fetchJson<SimpleProject>(url, { timeoutMs: this.options.timeoutMs, headers: this.headers });
    const times = uploadTimes(body?.files ?? []);
    const dates = new Map<string, string>();
    for (const version of versions) {
      const parsed = pep440.parseVersion(version);
      const at = parsed ? times.get(parsed.text) : undefined;
      if (at) {
        dates.set(version, at);
      }
    }
    return dates;
  }

  async fetchAudit(name: string, version: string): Promise<AuditResponse> {
    if (!isWarehouse(this.index)) {
      return { status: 'unsupported' };
    }
    const base = this.index.replace(/\/simple$/, '');
    const url = `${base}/pypi/${encodeURIComponent(normalizeName(name))}/${encodeURIComponent(version)}/json`;
    let body: unknown;
    try {
      body = await fetchJson<unknown>(url, {
        timeoutMs: this.options.timeoutMs,
        headers: { ...this.headers, accept: 'application/json' },
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
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        !('vulnerabilities' in body) || !Array.isArray(body.vulnerabilities)) {
      throw new Error('Malformed PyPI audit response');
    }
    const advisories: SecurityAdvisory[] = [];
    for (const entry of body.vulnerabilities) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
          typeof entry.id !== 'string' || !entry.id.trim() ||
          (entry.summary != null && typeof entry.summary !== 'string') ||
          (entry.details != null && typeof entry.details !== 'string') ||
          (entry.link !== undefined && typeof entry.link !== 'string') ||
          (entry.withdrawn != null && (typeof entry.withdrawn !== 'string' || !entry.withdrawn.trim())) ||
          (entry.fixed_in !== undefined && (!Array.isArray(entry.fixed_in) ||
            !entry.fixed_in.every((value: unknown) => typeof value === 'string' && value.trim())))) {
        throw new Error('Malformed PyPI audit advisory');
      }
      if (entry.withdrawn != null) {
        continue;
      }
      advisories.push({
        id: entry.id,
        title: entry.summary || entry.details || entry.id,
        ...(entry.link !== undefined ? { url: entry.link } : {}),
        ...(entry.fixed_in !== undefined ? { fixedVersions: entry.fixed_in } : {}),
      });
    }
    return { status: 'checked', advisories };
  }

  /**
   * Summary, licence and links for one release. The simple index carries none of
   * this, and only Warehouse serves the JSON API that does, so a private index
   * simply yields nothing rather than an error.
   */
  async fetchInfo(name: string, version: string | undefined): Promise<PackageMeta | undefined> {
    if (!version || !isWarehouse(this.index)) {
      return undefined;
    }
    const base = this.index.replace(/\/simple$/, '');
    const url = `${base}/pypi/${normalizeName(name)}/${encodeURIComponent(version)}/json`;
    try {
      const body = await fetchJson<ProjectJson>(url, { timeoutMs: this.options.timeoutMs });
      return body?.info ? metaOf(body.info) : undefined;
    } catch {
      // Prose is a nicety; failing to get it must not blank out the rest of the card.
      return undefined;
    }
  }
}

/** Warehouse's JSON API, which only pypi.org and its mirrors implement. */
interface ProjectJson {
  info?: {
    summary?: string;
    license?: string;
    license_expression?: string;
    home_page?: string;
    author?: string;
    project_urls?: Record<string, string>;
  };
}

/** True for an index that also serves the Warehouse JSON API. */
export function isWarehouse(index: string): boolean {
  return /^https:\/\/pypi\.org(\/|$)/.test(index);
}

export function metaOf(info: NonNullable<ProjectJson['info']>): PackageMeta {
  const meta: PackageMeta = {};
  if (info.summary) {
    meta.description = info.summary;
  }
  // A long licence text is the whole licence file pasted in; only a short one is
  // an identifier worth showing on a card.
  const license = info.license_expression || info.license;
  if (license && license.length <= 40) {
    meta.license = license;
  }
  if (info.author) {
    meta.publisher = info.author;
  }
  const urls = info.project_urls ?? {};
  const homepage = info.home_page || urls.Homepage || urls.Documentation;
  if (homepage) {
    meta.homepage = homepage;
  }
  const repository = urls.Source || urls['Source Code'] || urls.Repository;
  if (repository) {
    meta.repository = repository;
  }
  return meta;
}

/** Latest upload of each version - a release is only complete once every file is up. */
export function uploadTimes(files: SimpleFile[]): Map<string, string> {
  const times = new Map<string, string>();
  for (const file of files) {
    const at = file['upload-time'];
    const version = file.filename ? versionFromFilename(file.filename) : undefined;
    const parsed = at && version ? pep440.parseVersion(version) : undefined;
    if (!parsed || !at) {
      continue;
    }
    const seen = times.get(parsed.text);
    if (!seen || at > seen) {
      times.set(parsed.text, at);
    }
  }
  return times;
}

/** PEP 503 name normalisation, which is how the index spells its URLs. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, '-');
}

/**
 * A release counts as withdrawn only when every one of its files is yanked -
 * yanking a single broken wheel does not retract the version.
 */
export function yankedVersions(files: SimpleFile[]): Set<string> {
  const counts = new Map<string, { total: number; yanked: number }>();

  for (const file of files) {
    const version = file.filename ? versionFromFilename(file.filename) : undefined;
    const parsed = version ? pep440.parseVersion(version) : undefined;
    if (!parsed) {
      continue;
    }
    const entry = counts.get(parsed.text) ?? { total: 0, yanked: 0 };
    entry.total++;
    if (file.yanked === true || typeof file.yanked === 'string') {
      entry.yanked++;
    }
    counts.set(parsed.text, entry);
  }

  const withdrawn = new Set<string>();
  for (const [version, entry] of counts) {
    if (entry.total === entry.yanked) {
      withdrawn.add(version);
    }
  }
  return withdrawn;
}

/** Fallback for indexes predating PEP 700, which list files but no versions. */
function derivedVersions(files: SimpleFile[]): string[] {
  const versions = new Set<string>();
  for (const file of files) {
    const version = file.filename ? versionFromFilename(file.filename) : undefined;
    if (version) {
      versions.add(version);
    }
  }
  return [...versions];
}

/**
 * Wheels spell their version as the second `-` separated field; source
 * distributions put it after the last `-` before the archive extension.
 */
export function versionFromFilename(filename: string): string | undefined {
  if (filename.toLowerCase().endsWith('.whl')) {
    const fields = filename.slice(0, -4).split('-');
    return fields.length >= 3 ? fields[1] : undefined;
  }

  const stripped = filename.replace(ARCHIVE_RE, '');
  if (stripped === filename) {
    return undefined;
  }
  const dash = stripped.lastIndexOf('-');
  return dash > 0 ? stripped.slice(dash + 1) : undefined;
}
