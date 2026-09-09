import * as semver from 'semver';
import type { VersionScheme } from './schemes';
import type { DependencyRef } from './types';

export const actionRuntimes = {
  node: { action: 'actions/setup-node', input: 'node-version', repository: 'actions/node-versions', homepage: 'https://nodejs.org/en/download' },
  python: { action: 'actions/setup-python', input: 'python-version', repository: 'actions/python-versions', homepage: 'https://www.python.org/downloads/' },
  go: { action: 'actions/setup-go', input: 'go-version', repository: 'actions/go-versions', homepage: 'https://go.dev/dl/' },
} satisfies Record<NonNullable<DependencyRef['actionRuntime']>, { action: string; input: string; repository: string; homepage: string }>;

/** Moving v4 and v4.1 tags compare only with tags of the same precision. */
export function actionVersion(tag: string): string | undefined {
  const match = /^v?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:\.(0|[1-9]\d*))?(-[\w.-]+)?$/.exec(tag);
  if (!match || (match[4] && !match[3])) return undefined;
  return semver.valid(`${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}${match[4] ?? ''}`) ?? undefined;
}

export function actionTagStyle(tag: string): string {
  return `${tag.startsWith('v') ? 'v' : ''}${tag.split('-')[0].split('.').length}`;
}

export const githubActionsScheme: VersionScheme = {
  isVersion: (tag) => !!actionVersion(tag),
  compare: (a, b) => semver.compare(actionVersion(a)!, actionVersion(b)!),
  isPrerelease: (tag) => !!semver.prerelease(actionVersion(tag)!)?.length,
  baseline: (tag) => actionVersion(tag) ? tag : undefined,
  isPinned: (tag) => !!actionVersion(tag),
  isRange: (tag) => !!actionVersion(tag),
  satisfies: (version, spec) => version === spec,
  maxSatisfying: (versions, spec) => versions.includes(spec) ? spec : undefined,
  max: (versions, opts) => versions.filter((tag) => actionVersion(tag)
    && (opts.includePrerelease || !semver.prerelease(actionVersion(tag)!)))
    .sort((a, b) => semver.compare(actionVersion(a)!, actionVersion(b)!)).at(-1),
  classify: (a, b) => {
    const diff = semver.diff(actionVersion(a)!, actionVersion(b)!);
    if (diff === 'major' || diff === 'premajor') return 'major';
    if (diff === 'minor' || diff === 'preminor') return 'minor';
    return diff === 'patch' || diff === 'prepatch' ? 'patch' : 'prerelease';
  },
};
