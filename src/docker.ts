import * as semver from 'semver';
import type { VersionScheme } from './schemes';

/** Only numeric tags, optionally followed by a distribution variant, are ordered. */
export function dockerTag(tag: string): { version: string; style: string } | undefined {
  const match = /^(v?)(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(-[a-zA-Z][\w.-]*)?$/.exec(tag);
  if (!match) return undefined;
  const version = `${match[2]}.${match[3] ?? 0}.${match[4] ?? 0}`;
  if (!semver.valid(version)) return undefined;
  return { version, style: `${match[1]}${match[4] ? 3 : match[3] ? 2 : 1}${match[5] ?? ''}` };
}

export const dockerScheme: VersionScheme = {
  isVersion: (tag) => !!dockerTag(tag),
  compare: (a, b) => semver.compare(dockerTag(a)!.version, dockerTag(b)!.version),
  isPrerelease: (tag) => /(?:^|-)(?:alpha|beta|rc|preview|dev|nightly)(?:[.\d-]|$)/i.test(tag),
  baseline: (tag) => dockerTag(tag) ? tag : undefined,
  isPinned: (tag) => !!dockerTag(tag),
  isRange: (tag) => !!dockerTag(tag),
  satisfies: (version, spec) => version === spec,
  maxSatisfying: (versions, spec) => versions.includes(spec) ? spec : undefined,
  max: (versions, opts) => versions.filter((tag) => dockerTag(tag) && (opts.includePrerelease || !dockerScheme.isPrerelease(tag)))
    .sort(dockerScheme.compare).at(-1),
  classify: (a, b) => {
    const diff = semver.diff(dockerTag(a)!.version, dockerTag(b)!.version);
    return diff === 'major' || diff === 'minor' || diff === 'patch' ? diff : 'prerelease';
  },
};
