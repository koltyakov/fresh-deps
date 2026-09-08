import type { Ecosystem } from './types';

const MINUTE = 60_000;
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * MINUTE],
  ['month', 30 * 24 * 60 * MINUTE],
  ['week', 7 * 24 * 60 * MINUTE],
  ['day', 24 * 60 * MINUTE],
  ['hour', 60 * MINUTE],
  ['minute', MINUTE],
];

/** Go writes its versions with a `v`; npm, crates.io and PyPI write them bare. */
export function display(version: string, ecosystem: Ecosystem): string {
  return ecosystem === 'go' && !version.startsWith('v') ? `v${version}` : version;
}

/** "3 months ago", the way a release date is read at a glance. */
export function relativeTime(iso: string, now = Date.now()): string | undefined {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) {
    return undefined;
  }
  const elapsed = now - at;
  const format = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, ms] of UNITS) {
    if (Math.abs(elapsed) >= ms) {
      return format.format(-Math.round(elapsed / ms), unit);
    }
  }
  return format.format(0, 'day');
}

/** "13 May 2026 (3 months ago)" - the exact date, plus how long ago that was. */
export function publishedOn(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) {
    return undefined;
  }
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) {
    return undefined;
  }
  const absolute = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const relative = relativeTime(iso, now);
  return relative ? `${absolute} (${relative})` : absolute;
}

/** Package footprint in the units npm itself reports it in. */
export function formatSize(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * Registry prose is arbitrary text. Only the characters that would break the card
 * are escaped - a table cell, emphasis, code, a link, or a `$(icon)` reference -
 * so that URLs in a description still come out as URLs.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]|$<>]/g, '\\$&').replace(/\s+/g, ' ').trim();
}
