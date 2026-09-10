import * as semver from 'semver';
import { fetchJson } from '../http';
import type { PackageMeta, RegistryVersions } from '../types';
import { goEnv } from '../goenv';

const DEFAULT_PROXY = 'https://proxy.golang.org';
/** How far past the current major to look before giving up. */
const MAX_MAJOR_PROBES = 6;
/** Modules skip majors (v1 straight to v3), so a miss is not the end of the line. */
const MAX_CONSECUTIVE_MISSES = 2;

interface LatestInfo {
  Version?: string;
  /** When the version was tagged. The proxy returns it on every info request. */
  Time?: string;
  Origin?: { URL?: string };
}

export interface GoClientOptions {
  proxyOverride?: string;
  checkMajorVersions: boolean;
  timeoutMs: number;
}

export class GoClient {
  /** Resolved proxy base URL, or undefined when GOPROXY disables the proxy. */
  readonly proxy: string | undefined;

  constructor(private readonly options: GoClientOptions) {
    this.proxy = resolveProxy(options.proxyOverride);
  }

  async fetchLatest(modulePath: string): Promise<RegistryVersions> {
    const exclusion = proxyExclusion(modulePath);
    if (exclusion) {
      return { error: exclusion };
    }
    if (!this.proxy) {
      return { error: 'GOPROXY is off' };
    }

    const base = await this.latestOf(modulePath);
    if (!base) {
      return { error: 'not found' };
    }

    let best: RegistryVersions = {
      latest: base.version,
      all: [base.raw],
      latestRaw: base.raw,
      path: modulePath,
      meta: base.meta,
    };
    if (!this.options.checkMajorVersions) {
      return best;
    }

    const layout = majorLayout(modulePath);
    const startMajor = Math.max(semver.major(base.version) || 0, layout.major, 1);
    let misses = 0;
    for (let major = startMajor + 1; major <= startMajor + MAX_MAJOR_PROBES; major++) {
      const candidatePath = layout.pathFor(major);
      const candidate = await this.latestOf(candidatePath);
      if (!candidate) {
        if (++misses >= MAX_CONSECUTIVE_MISSES) {
          break;
        }
        continue;
      }
      misses = 0;
      best = {
        latest: candidate.version,
        all: [...best.all!, candidate.raw],
        latestRaw: candidate.raw,
        path: candidatePath,
        meta: candidate.meta,
      };
    }
    return best;
  }

  /**
   * Publish date of one specific version. A `.info` request is a couple of hundred
   * bytes, but it is still a request, so it is made only when someone asks to see
   * the date rather than on every check.
   */
  async fetchPublishDate(modulePath: string, version: string): Promise<string | undefined> {
    if (!this.proxy || proxyExclusion(modulePath)) {
      return undefined;
    }
    // The proxy indexes versions exactly as go.mod writes them, `v` prefix and all.
    const tag = version.trim().startsWith('v') ? version.trim() : `v${version.trim()}`;
    const url = `${this.proxy}/${escapeModulePath(modulePath)}/@v/${encodeURIComponent(tag)}.info`;
    const info = await fetchJson<LatestInfo>(url, { timeoutMs: this.options.timeoutMs });
    return info?.Time;
  }

  private async latestOf(modulePath: string): Promise<Resolved | undefined> {
    if (proxyExclusion(modulePath)) {
      return undefined;
    }
    const url = `${this.proxy}/${escapeModulePath(modulePath)}/@latest`;
    const info = await fetchJson<LatestInfo>(url, { timeoutMs: this.options.timeoutMs });
    if (!info?.Version) {
      return undefined;
    }
    // `+incompatible` is dropped for comparison but kept for display, since it is
    // part of the version string that has to be written into go.mod.
    const version = info.Version.replace(/^v/, '').replace(/\+incompatible$/, '');
    if (!semver.valid(version, { loose: true })) {
      return undefined;
    }
    return { version, raw: info.Version, meta: metaOf(info) };
  }
}

export function proxyExclusion(modulePath: string): string | undefined {
  const source = goEnv('GONOPROXY') ? 'GONOPROXY' : 'GOPRIVATE';
  if (matchesPrefixPatterns(goEnv(source) ?? '', modulePath)) {
    return `skipped: module excluded from proxy requests by ${source}`;
  }
  return undefined;
}

/** Go's module.MatchPrefixPatterns: path.Match globs apply to path prefixes. */
export function matchesPrefixPatterns(patterns: string, modulePath: string): boolean {
  return patterns.split(',').some((entry) => {
    const pattern = entry.replace(/\/$/, '');
    if (!pattern) return false;
    const count = pattern.split('/').length;
    const parts = modulePath.split('/');
    if (parts.length < count) return false;
    let expression = '';
    const chars = Array.from(pattern);
    const literal = (char: string) => `\\u{${char.codePointAt(0)!.toString(16)}}`;
    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      if (char === '*') {
        expression += '[^/]*';
      } else if (char === '?') {
        expression += '[^/]';
      } else if (char === '\\') {
        if (++i === chars.length) return false;
        expression += literal(chars[i]);
      } else if (char === '[') {
        let range = '';
        let terms = 0;
        const negate = chars[i + 1] === '^';
        if (negate) i++;
        while (++i < chars.length && chars[i] !== ']') {
          if (chars[i] === '-') return false;
          if (chars[i] === '\\' && ++i === chars.length) return false;
          const low = chars[i];
          let high = low;
          if (chars[i + 1] === '-') {
            i += 2;
            if (i === chars.length || chars[i] === ']' || chars[i] === '-') return false;
            if (chars[i] === '\\' && ++i === chars.length) return false;
            high = chars[i];
          }
          terms++;
          // Go permits reversed ranges; they simply match no characters.
          if (low.codePointAt(0)! <= high.codePointAt(0)!) {
            range += low === high ? literal(low) : `${literal(low)}-${literal(high)}`;
          }
        }
        if (!terms || i === chars.length) return false;
        expression += `[${negate ? '^' : ''}${range}]`;
      } else {
        expression += literal(char);
      }
    }
    return new RegExp(`^${expression}$`, 'u').test(parts.slice(0, count).join('/'));
  });
}

/**
 * The module proxy expects uppercase letters to be escaped as `!` plus the
 * lowercase letter, so that paths stay unambiguous on case-insensitive systems.
 */
interface Resolved {
  version: string;
  raw: string;
  meta: PackageMeta;
}

/**
 * The proxy hands back the tag date and the repository it came from on the same
 * response that resolves the version, so both are free to keep.
 */
export function metaOf(info: LatestInfo): PackageMeta {
  const meta: PackageMeta = {};
  if (info.Time) {
    meta.latestPublishedAt = info.Time;
  }
  if (info.Origin?.URL) {
    meta.repository = info.Origin.URL.replace(/\.git$/, '');
  }
  return meta;
}

export function escapeModulePath(modulePath: string): string {
  return modulePath.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);
}

interface MajorLayout {
  /** Major version encoded in the path, or 0 when there is none. */
  major: number;
  pathFor(major: number): string;
}

/**
 * Go encodes major versions in the import path: `/v2` for most modules, `.v2`
 * for the gopkg.in convention.
 */
export function majorLayout(modulePath: string): MajorLayout {
  const slash = modulePath.match(/^(.*)\/v(\d+)$/);
  if (slash) {
    const base = slash[1];
    return { major: Number(slash[2]), pathFor: (m) => `${base}/v${m}` };
  }

  const gopkg = modulePath.match(/^(gopkg\.in\/.*)\.v(\d+)$/);
  if (gopkg) {
    const base = gopkg[1];
    return { major: Number(gopkg[2]), pathFor: (m) => `${base}.v${m}` };
  }

  return { major: 0, pathFor: (m) => `${modulePath}/v${m}` };
}

/** Picks the first HTTP proxy out of GOPROXY, honouring `off`. */
export function resolveProxy(override?: string): string | undefined {
  const raw = (override || goEnv('GOPROXY') || DEFAULT_PROXY).trim();
  if (raw === '' ) {
    return DEFAULT_PROXY;
  }
  for (const entry of raw.split(/[,|]/).map((e) => e.trim())) {
    if (entry === 'off') {
      return undefined;
    }
    if (entry.startsWith('http://') || entry.startsWith('https://')) {
      return entry.replace(/\/+$/, '');
    }
  }
  return undefined;
}
