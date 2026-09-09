import * as semver from 'semver';

const LOOSE = { loose: true } as const;

function upperBound(version: string): string | undefined {
  const core = version.split('-')[0];
  const parts = core.split('.');
  if (!parts.every((part) => /^\d+$/.test(part))) return undefined;
  const numbers = parts.map(Number);
  const index = Math.max(0, numbers.length - 2);
  const upper = numbers.slice(0, index + 1);
  upper[index]++;
  while (upper.length < 3) upper.push(0);
  return upper.join('.');
}

export function pessimisticRange(spec: string, dialect: 'terraform' | 'hex'): string | undefined {
  let value = spec.trim();
  if (!value) return undefined;
  if (dialect === 'hex') value = value.replace(/\band\b/gi, ' ').replace(/\bor\b/gi, ' || ');
  else if (value.includes('||')) return undefined;
  const alternatives = value.split(/\s*\|\|\s*/).map((alternative) => {
    const rawParts = dialect === 'terraform' ? alternative.split(',') : alternative.split(/\s+(?=[<>=~])/);
    const parts = rawParts.map((part) => part.trim()).filter(Boolean);
    let translated: string[][] = [[]];
    for (const part of parts) {
      const match = part.match(/^(~>|>=|<=|!=|==|=|>|<)?\s*(v?\d+(?:\.\d+){0,2}(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/);
      if (!match) return undefined;
      const op = match[1] ?? '=';
      const version = match[2].replace(/^v/, '');
      if (op === '~>') {
        const upper = upperBound(version);
        if (!upper) return undefined;
        translated.forEach((branch) => branch.push(`>=${version}`, `<${upper}${dialect === 'hex' ? '-0' : ''}`));
      } else if (op === '!=') {
        translated = translated.flatMap((branch) => [[...branch, `<${version}`], [...branch, `>${version}`]]);
      } else if (op === '=' || op === '==') {
        const exact = `${version.split('-')[0].split('+')[0].split('.').concat(['0', '0']).slice(0, 3).join('.')}${version.includes('-') ? `-${version.split('-')[1].split('+')[0]}` : ''}${version.includes('+') ? `+${version.split('+')[1]}` : ''}`;
        translated.forEach((branch) => branch.push(`=${exact}`));
      } else translated.forEach((branch) => branch.push(`${op}${version}`));
    }
    return translated.map((branch) => branch.join(' ')).join(' || ');
  });
  if (alternatives.some((part) => !part)) return undefined;
  const range = alternatives.join(' || ');
  return semver.validRange(range, LOOSE) ? range : undefined;
}
