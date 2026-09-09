import * as semver from 'semver';

/** Packagist's release spelling may omit patch numbers or use RC1 rather than rc.1. */
export function composerVersion(raw: string): string | undefined {
  const match = raw.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.0)?(?:[-.]?(alpha|a|beta|b|RC|rc|patch|pl|p)[.-]?(\d*)|(-[0-9A-Za-z.-]+))?(\+[0-9A-Za-z.-]+)?$/);
  if (!match) return undefined;
  const tag = match[4]?.toLowerCase();
  // Composer patch-level releases do not have SemVer ordering. Do not misorder them.
  if (tag && ['patch', 'pl', 'p'].includes(tag)) return undefined;
  const suffix = tag ? `-${tag === 'a' ? 'alpha' : tag === 'b' ? 'beta' : tag}${match[5] ? `.${match[5]}` : ''}` : match[6] ?? '';
  const version = `${match[1]}.${match[2] ?? '0'}.${match[3] ?? '0'}${suffix}${match[7] ?? ''}`;
  return semver.valid(version) ?? undefined;
}

/** Translate the numeric subset of Composer constraints; reject branch and stability expressions. */
export function composerRange(spec: string): string | undefined {
  if (!spec.trim() || /@|\bas\b|dev|!=|<>/i.test(spec)) return undefined;
  const alternatives = spec.split(/\|\|?/).map((part) => {
    const input = part.trim().replace(/,/g, ' ').replace(/(>=|<=|>|<|=|\^|~)\s+/g, '$1');
    // Composer and npm agree on hyphen ranges and wildcard bounds.
    if (/\s-\s/.test(input)) return input;
    return input.split(/\s+/).map((token) => {
      const match = token.match(/^(>=|<=|>|<|==|=|\^|~)?(v?\d+(?:\.\d+){0,2}(?:[-.]?(?:alpha|beta|RC|rc)[.-]?\d*)?)$/);
      if (!match) return token;
      const version = composerVersion(match[2]);
      if (!version) return '!invalid';
      const operator = match[1] ?? '';
      if (operator === '~' || operator === '^') {
        const numbers = match[2].replace(/^v/, '').match(/^\d+(?:\.\d+)*/)?.[0].split('.') ?? [];
        const major = Number(numbers[0]);
        const minor = Number(numbers[1] ?? 0);
        const patch = Number(numbers[2] ?? 0);
        const upper = operator === '~'
          ? numbers.length >= 3 ? `${major}.${minor + 1}.0` : `${major + 1}.0.0`
          : major > 0 || numbers.length === 1 ? `${major + 1}.0.0`
          : minor > 0 || numbers.length === 2 ? `0.${minor + 1}.0` : `0.0.${patch + 1}`;
        return `>=${version} <${upper}`;
      }
      return `${operator === '==' ? '=' : operator}${version}`;
    }).join(' ');
  });
  if (alternatives.some((part) => !part)) return undefined;
  const range = alternatives.join(' || ');
  return semver.validRange(range) ? range : undefined;
}
