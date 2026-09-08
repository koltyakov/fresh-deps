import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PipConfig {
  get(key: string): string | undefined;
}

const DEFAULT_INDEX = 'https://pypi.org/simple';

function parse(content: string, into: Map<string, string>): void {
  let section = 'global';

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) {
      continue;
    }
    if (line.startsWith('[')) {
      section = line.slice(1, line.indexOf(']') === -1 ? line.length : line.indexOf(']')).trim().toLowerCase();
      continue;
    }
    const separator = line.search(/[=:]/);
    if (separator === -1) {
      continue;
    }
    // pip accepts both spellings of a key.
    const key = line.slice(0, separator).trim().toLowerCase().replace(/_/g, '-');
    into.set(`${section}.${key}`, line.slice(separator + 1).trim());
  }
}

/** pip's configuration files, in increasing order of precedence. */
function configFiles(): string[] {
  const home = os.homedir();
  const files: string[] = [];

  if (process.platform === 'win32') {
    const programData = process.env.PROGRAMDATA;
    if (programData) {
      files.push(path.join(programData, 'pip', 'pip.ini'));
    }
    const appData = process.env.APPDATA;
    if (appData) {
      files.push(path.join(appData, 'pip', 'pip.ini'));
    }
    files.push(path.join(home, 'pip.ini'));
    return files;
  }

  files.push('/etc/pip.conf');
  if (process.platform === 'darwin') {
    files.push(path.join(home, 'Library', 'Application Support', 'pip', 'pip.conf'));
  }
  files.push(path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'pip', 'pip.conf'));
  files.push(path.join(home, '.pip', 'pip.conf'));
  return files;
}

/** Reads pip's configuration files, the most specific one winning. */
export function readPipConfig(): PipConfig {
  const values = new Map<string, string>();

  for (const file of configFiles()) {
    try {
      parse(fs.readFileSync(file, 'utf8'), values);
    } catch {
      // Missing or unreadable pip config files are expected.
    }
  }

  return { get: (key) => values.get(key) };
}

/**
 * The index to query: an explicit setting first, then the environment variables
 * pip and uv both honour, then the config files, then PyPI.
 */
export function resolveIndexUrl(override: string | undefined, config: PipConfig): string {
  const candidates = [
    override,
    process.env.PIP_INDEX_URL,
    process.env.UV_INDEX_URL,
    config.get('global.index-url'),
    config.get('install.index-url'),
  ];
  const chosen = candidates.map((value) => value?.trim()).find((value) => !!value);
  return (chosen || DEFAULT_INDEX).replace(/\/+$/, '');
}

/**
 * Splits credentials out of an index URL into a Basic auth header - the form
 * pip accepts, and the one `fetch` drops on the floor if it is left in place.
 */
export function splitCredentials(indexUrl: string): { url: string; auth?: string } {
  let parsed: URL;
  try {
    parsed = new URL(indexUrl);
  } catch {
    return { url: indexUrl };
  }

  if (!parsed.username && !parsed.password) {
    return { url: indexUrl };
  }

  const credentials = `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`;
  parsed.username = '';
  parsed.password = '';
  return { url: parsed.toString().replace(/\/+$/, ''), auth: `Basic ${Buffer.from(credentials).toString('base64')}` };
}
