/**
 * PEP 440 versions and version specifiers.
 *
 * Python versions are not semver and cannot be coerced into it: they carry an
 * epoch (`1!2.0`), a release tuple of any length (`2020.6.20`), post-releases
 * (`1.0.post1`) and dev releases, and the `~=` operator has no semver
 * equivalent. So the ordering and matching rules are implemented here, following
 * the spec and the reference behaviour of the `packaging` library.
 */

export interface Pep440Version {
  epoch: number;
  release: number[];
  /** Prerelease marker normalised to `a`, `b` or `rc`, with its number. */
  pre?: { letter: string; num: number };
  post?: number;
  dev?: number;
  local?: (string | number)[];
  /** Canonical spelling, used for display and for `===`. */
  text: string;
}

const VERSION_RE =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)([-_.]?(?:alpha|a|beta|b|preview|pre|c|rc)[-_.]?\d*)?((?:-\d+)|(?:[-_.]?(?:post|rev|r)[-_.]?\d*))?([-_.]?dev[-_.]?\d*)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/;

/** Spellings the spec allows for each prerelease phase, and what they normalise to. */
const PRE_LETTERS: Record<string, string> = {
  alpha: 'a',
  a: 'a',
  beta: 'b',
  b: 'b',
  c: 'rc',
  pre: 'rc',
  preview: 'rc',
  rc: 'rc',
};

export function parseVersion(raw: string): Pep440Version | undefined {
  const match = VERSION_RE.exec(raw.trim().toLowerCase());
  if (!match) {
    return undefined;
  }

  const [, epoch, release, pre, post, dev, local] = match;
  const parsed: Pep440Version = {
    epoch: epoch ? Number(epoch) : 0,
    release: release.split('.').map(Number),
    text: '',
  };

  if (pre) {
    const [, letter, num] = /^[-_.]?([a-z]+)[-_.]?(\d*)$/.exec(pre) ?? [];
    parsed.pre = { letter: PRE_LETTERS[letter] ?? letter, num: num ? Number(num) : 0 };
  }
  if (post) {
    // Either the implicit `-N` form or an explicit `.postN` / `.revN` / `.rN`.
    const [, implicit, explicit] = /^-(\d+)$|^[-_.]?[a-z]+[-_.]?(\d*)$/.exec(post) ?? [];
    parsed.post = Number(implicit || explicit || 0);
  }
  if (dev) {
    const [, num] = /(\d*)$/.exec(dev) ?? [];
    parsed.dev = num ? Number(num) : 0;
  }
  if (local) {
    parsed.local = local.split(/[-_.]/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  }

  parsed.text = format(parsed);
  return parsed;
}

function format(version: Pep440Version): string {
  let out = version.epoch ? `${version.epoch}!` : '';
  out += version.release.join('.');
  if (version.pre) {
    out += `${version.pre.letter}${version.pre.num}`;
  }
  if (version.post !== undefined) {
    out += `.post${version.post}`;
  }
  if (version.dev !== undefined) {
    out += `.dev${version.dev}`;
  }
  if (version.local) {
    out += `+${version.local.join('.')}`;
  }
  return out;
}

export function isValid(raw: string): boolean {
  return parseVersion(raw) !== undefined;
}

/** A prerelease in the sense the spec uses to hide versions by default: `a`/`b`/`rc` or `dev`. */
export function isPrerelease(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed ? isPrereleaseParsed(parsed) : false;
}

function isPrereleaseParsed(version: Pep440Version): boolean {
  return version.pre !== undefined || version.dev !== undefined;
}

export function compare(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) {
    return 0;
  }
  return compareParsed(left, right);
}

/** Trailing zeros carry no meaning: `1.0` and `1.0.0` are the same release. */
function significantRelease(release: number[]): number[] {
  const out = release.slice();
  while (out.length > 1 && out[out.length - 1] === 0) {
    out.pop();
  }
  return out;
}

function compareRelease(a: number[], b: number[]): number {
  const left = significantRelease(a);
  const right = significantRelease(b);
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * Where a version sits relative to the plain release: a lone dev release comes
 * before every prerelease of it, a prerelease before the release itself.
 */
function preRank(version: Pep440Version): number {
  if (version.pre) {
    return 0;
  }
  return version.post === undefined && version.dev !== undefined ? -1 : 1;
}

function compareLocal(a: (string | number)[] | undefined, b: (string | number)[] | undefined): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return -1;
  }
  if (!b) {
    return 1;
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) {
      return -1;
    }
    if (right === undefined) {
      return 1;
    }
    // A numeric segment always sorts above an alphanumeric one.
    if (typeof left === 'number' && typeof right === 'number') {
      if (left !== right) {
        return left - right;
      }
    } else if (typeof left === 'number') {
      return 1;
    } else if (typeof right === 'number') {
      return -1;
    } else if (left !== right) {
      return left < right ? -1 : 1;
    }
  }
  return 0;
}

export function compareParsed(a: Pep440Version, b: Pep440Version): number {
  if (a.epoch !== b.epoch) {
    return a.epoch - b.epoch;
  }

  const release = compareRelease(a.release, b.release);
  if (release !== 0) {
    return release;
  }

  const rank = preRank(a) - preRank(b);
  if (rank !== 0) {
    return rank;
  }
  if (a.pre && b.pre) {
    if (a.pre.letter !== b.pre.letter) {
      return a.pre.letter < b.pre.letter ? -1 : 1;
    }
    if (a.pre.num !== b.pre.num) {
      return a.pre.num - b.pre.num;
    }
  }

  // No post-release sorts below any post-release; no dev release sorts above one.
  const post = (a.post ?? -1) - (b.post ?? -1);
  if (post !== 0) {
    return post;
  }
  const aDev = a.dev ?? Infinity;
  const bDev = b.dev ?? Infinity;
  if (aDev !== bDev) {
    return aDev < bDev ? -1 : 1;
  }

  return compareLocal(a.local, b.local);
}

export interface Clause {
  op: string;
  /** Version text as written, with any `.*` removed. */
  version: string;
  wildcard: boolean;
  parsed?: Pep440Version;
}

const CLAUSE_RE = /^(===|==|!=|~=|<=|>=|<|>)\s*(.+)$/;

/** Parses a comma-separated specifier set. Returns undefined when it is not one. */
export function parseSpecifierSet(spec: string): Clause[] | undefined {
  const clauses: Clause[] = [];

  for (const raw of spec.split(',')) {
    const part = raw.trim();
    if (part === '') {
      continue;
    }

    const match = CLAUSE_RE.exec(part);
    if (!match) {
      return undefined;
    }

    const op = match[1];
    let version = match[2].trim();
    const wildcard = version.endsWith('.*');
    if (wildcard) {
      if (op !== '==' && op !== '!=') {
        return undefined;
      }
      version = version.slice(0, -2);
    }

    if (op === '===') {
      clauses.push({ op, version, wildcard: false });
      continue;
    }

    const parsed = parseVersion(version);
    // `~=` compares everything but the last component, so it needs at least two.
    if (!parsed || (op === '~=' && parsed.release.length < 2)) {
      return undefined;
    }
    clauses.push({ op, version, wildcard, parsed });
  }

  return clauses.length ? clauses : undefined;
}

export function isSpecifierSet(spec: string): boolean {
  return parseSpecifierSet(spec) !== undefined;
}

/** True when the specifier admits exactly one version. */
export function isPinned(spec: string): boolean {
  const clauses = parseSpecifierSet(spec);
  if (!clauses || clauses.length !== 1) {
    return false;
  }
  const [clause] = clauses;
  return (clause.op === '==' && !clause.wildcard) || clause.op === '===';
}

/**
 * The lowest version the specifier allows - the baseline an update is measured
 * from. Specifiers that only rule versions out (`!=`, `<`) have no floor.
 */
export function baselineOf(spec: string): string | undefined {
  const clauses = parseSpecifierSet(spec);
  if (!clauses) {
    return undefined;
  }

  let floor: Pep440Version | undefined;
  for (const clause of clauses) {
    const candidate =
      clause.op === '===' ? parseVersion(clause.version) : ['>=', '>', '~=', '=='].includes(clause.op) ? clause.parsed : undefined;
    if (candidate && (!floor || compareParsed(candidate, floor) > 0)) {
      floor = candidate;
    }
  }
  return floor?.text;
}

function withoutLocal(version: Pep440Version): Pep440Version {
  return version.local ? { ...version, local: undefined } : version;
}

/** Epoch and release only - what the spec calls the base version. */
function sameBase(a: Pep440Version, b: Pep440Version): boolean {
  return a.epoch === b.epoch && compareRelease(a.release, b.release) === 0;
}

function prefixEqual(version: Pep440Version, epoch: number, prefix: number[]): boolean {
  return version.epoch === epoch && prefix.every((component, i) => (version.release[i] ?? 0) === component);
}

function equal(version: Pep440Version, clause: Pep440Version): boolean {
  // A specifier without a local label ignores the candidate's local label.
  return compareParsed(clause.local ? version : withoutLocal(version), clause) === 0;
}

function matches(version: Pep440Version, clause: Clause): boolean {
  if (clause.op === '===') {
    return version.text === (parseVersion(clause.version)?.text ?? clause.version.trim().toLowerCase());
  }

  const spec = clause.parsed;
  if (!spec) {
    return false;
  }
  const plain = withoutLocal(version);

  switch (clause.op) {
    case '==':
      return clause.wildcard ? prefixEqual(version, spec.epoch, spec.release) : equal(version, spec);
    case '!=':
      return !(clause.wildcard ? prefixEqual(version, spec.epoch, spec.release) : equal(version, spec));
    case '~=':
      // `~= X.Y.Z` is `>= X.Y.Z` combined with `== X.Y.*`.
      return compareParsed(plain, spec) >= 0 && prefixEqual(version, spec.epoch, spec.release.slice(0, -1));
    case '<=':
      return compareParsed(plain, spec) <= 0;
    case '>=':
      return compareParsed(plain, spec) >= 0;
    case '<':
      // `< V` excludes prereleases of V itself, unless V is one.
      return (
        compareParsed(plain, spec) < 0 && !(isPrereleaseParsed(version) && !isPrereleaseParsed(spec) && sameBase(version, spec))
      );
    case '>':
      // `> V` excludes post-releases and local builds of V itself.
      return (
        compareParsed(plain, spec) > 0 &&
        !(version.post !== undefined && spec.post === undefined && sameBase(version, spec)) &&
        !(version.local !== undefined && sameBase(version, spec))
      );
    default:
      return false;
  }
}

export interface MatchOptions {
  includePrerelease: boolean;
}

export function satisfies(version: string, spec: string, opts: MatchOptions): boolean {
  const clauses = parseSpecifierSet(spec);
  return clauses ? satisfiesClauses(version, clauses, opts) : false;
}

function satisfiesClauses(version: string, clauses: Clause[], opts: MatchOptions): boolean {
  const parsed = parseVersion(version);
  if (!parsed) {
    return false;
  }
  // Prereleases are invisible unless asked for, or unless the specifier itself
  // names one - the rule pip applies when resolving.
  if (
    isPrereleaseParsed(parsed) &&
    !opts.includePrerelease &&
    !clauses.some((clause) => clause.parsed && isPrereleaseParsed(clause.parsed))
  ) {
    return false;
  }
  return clauses.every((clause) => matches(parsed, clause));
}

export function maxSatisfying(versions: string[], spec: string, opts: MatchOptions): string | undefined {
  const clauses = parseSpecifierSet(spec);
  if (!clauses) {
    return undefined;
  }
  return best(versions.filter((version) => satisfiesClauses(version, clauses, opts)));
}

export function max(versions: string[], opts: MatchOptions): string | undefined {
  const candidates = opts.includePrerelease ? versions : versions.filter((version) => !isPrerelease(version));
  return best(candidates.length ? candidates : versions);
}

function best(versions: string[]): string | undefined {
  let winner: { raw: string; parsed: Pep440Version } | undefined;
  for (const raw of versions) {
    const parsed = parseVersion(raw);
    if (parsed && (!winner || compareParsed(parsed, winner.parsed) > 0)) {
      winner = { raw, parsed };
    }
  }
  return winner?.raw;
}
