import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface NpmConfig {
  get(key: string): string | undefined;
}

/** Expands `${VAR}` references the way npm does when reading .npmrc values. */
function expand(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => process.env[name] ?? '');
}

function parse(content: string, into: Map<string, string>): void {
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';') || line.startsWith('[')) {
      continue;
    }
    const eq = line.indexOf('=');
    if (eq === -1) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Closest file wins: only fill keys that are still unset.
    if (!into.has(key)) {
      into.set(key, expand(value));
    }
  }
}

/**
 * Reads .npmrc files from the manifest directory upwards, then the user's home
 * directory — the same precedence npm itself applies.
 */
export function readNpmConfig(startDir: string): NpmConfig {
  const values = new Map<string, string>();
  const files: string[] = [];

  let dir = startDir;
  for (;;) {
    files.push(path.join(dir, '.npmrc'));
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  files.push(path.join(os.homedir(), '.npmrc'));

  for (const file of files) {
    try {
      parse(fs.readFileSync(file, 'utf8'), values);
    } catch {
      // Missing or unreadable .npmrc files are expected.
    }
  }

  return { get: (key) => values.get(key) };
}

/** Finds the auth token configured for a registry, matching npm's longest-prefix rule. */
export function authTokenFor(config: NpmConfig, registry: string): string | undefined {
  let url: URL;
  try {
    url = new URL(registry);
  } catch {
    return undefined;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  for (let n = segments.length; n >= 0; n--) {
    const prefix = `//${url.host}${segments.length ? '/' + segments.slice(0, n).join('/') : ''}`;
    const token =
      config.get(`${prefix}/:_authToken`) ??
      config.get(`${prefix}:_authToken`) ??
      config.get(`${prefix}/:_auth`) ??
      config.get(`${prefix}:_auth`);
    if (token) {
      return token;
    }
  }
  return undefined;
}
