// Packages the extension into a .vsix and installs it into the local VSCode.
// Run with `npm run vscode:install`; set FRESH_DEPS_VSCODE_CLI to point at a
// different CLI (`code-insiders`, `cursor`, an absolute path, ...).
import { spawn } from 'node:child_process';
import { access, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';

function runCommand(command, args) {
  return new Promise((resolveCommand, rejectCommand) => {
    // Windows resolves `code` through a .cmd shim, which spawn only runs via a shell.
    const child = spawn(command, args, {
      cwd: projectRoot,
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      shell: isWindows,
      stdio: 'inherit',
    });
    child.once('error', rejectCommand);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveCommand();
        return;
      }
      const outcome = signal ? `signal ${signal}` : `exit code ${code}`;
      rejectCommand(new Error(`${command} failed with ${outcome}`));
    });
  });
}

const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const vsixName = `${manifest.name}-${manifest.version}.vsix`;
const vsixPath = join(projectRoot, vsixName);
const vscodeCli = process.env.FRESH_DEPS_VSCODE_CLI?.trim() || (isWindows ? 'code.cmd' : 'code');

// npm_execpath keeps us on the npm that invoked the script rather than whatever is on PATH.
const npmExecPath = process.env.npm_execpath;
const packageCommand = npmExecPath
  ? [process.execPath, [npmExecPath, 'run', 'package']]
  : [isWindows ? 'npm.cmd' : 'npm', ['run', 'package']];

const staleVsixFiles = (await readdir(projectRoot)).filter(
  (entry) => entry.startsWith(`${manifest.name}-`) && entry.endsWith('.vsix')
);
await Promise.all(staleVsixFiles.map((file) => rm(join(projectRoot, file), { force: true })));

await runCommand(...packageCommand);
await access(vsixPath);
await runCommand(vscodeCli, ['--install-extension', isWindows ? `"${vsixPath}"` : vsixPath, '--force']);

console.log(`\nInstalled ${vsixName}. Reload the VSCode window to pick it up.`);
