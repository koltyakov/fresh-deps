import { homedir } from 'os';
import { join } from 'path';
import { readProjectFile } from './projectFiles';

export function goEnv(name: string): string | undefined {
  if (process.env[name] !== undefined) return process.env[name];
  if (process.env.GOENV === 'off') return undefined;
  const base = process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || homedir() : process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const text = readProjectFile(process.env.GOENV || join(base, 'go', 'env'));
  return text?.split(/\r?\n/).find((line) => line.startsWith(`${name}=`))?.slice(name.length + 1);
}
