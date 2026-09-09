import { isMap, isScalar, isSeq } from 'yaml';
import { actionRuntimes, actionVersion } from '../githubActions';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function parseGithubActions(text: string, readVersionFile?: (filename: string) => string | undefined): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const line = doc.line;
  const deps: DependencyRef[] = [];
  function uses(node: unknown, section: string, setup = false, matrix?: unknown): void {
    if (!isMap(node)) return;
    const value = node.get('uses', true);
    const raw = yamlString(value);
    const match = raw && /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/[^@\s]+)?@([^\s]+)$/.exec(raw);
    if (!match || match[1].split('/').some((part) => /^\.+$/.test(part))) return;
    if (actionVersion(match[3])) {
      deps.push({ name: match[1], spec: match[3], line: line(value), section,
        ...(match[2] ? { alias: match[1] + match[2] } : {}) });
    }
    else if (/^[a-f\d]{40}$/i.test(match[3])) {
      const comment = text.split(/\r?\n/)[line(value)]?.match(/#\s*(v?\d+(?:\.\d+){0,2})\s*$/)?.[1];
      if (comment && actionVersion(comment)) deps.push({ name: match[1], spec: comment, specRaw: match[3], revision: match[3], line: line(value), section: `${section}.sha` });
    }
    // Inputs also work when the setup action itself is pinned to a SHA or branch.
    if (!setup || match[2]) return;
    const inputs = node.get('with', true);
    if (!isMap(inputs)) return;
    for (const [action, inputName, runtime] of [['actions/setup-dotnet', 'dotnet-version', 'dotnet'], ['hashicorp/setup-terraform', 'terraform_version', 'terraform']] as const) {
      const input = inputs.get(inputName, true);
      const spec = yamlString(input);
      if (match[1].toLowerCase() === action && spec && /^\d+\.\d+\.\d+$/.test(spec)) deps.push({ name: runtime, spec, runtime, semver: true,
        line: line(input), section: `${section}.with.${inputName}` });
    }
    for (const runtime of Object.keys(actionRuntimes) as NonNullable<DependencyRef['actionRuntime']>[]) {
      const config = actionRuntimes[runtime];
      if (match[1].toLowerCase() !== config.action) continue;
      let input = inputs.get(config.input, true);
      if (input === undefined && readVersionFile) {
        const fileNode = inputs.get(`${config.input}-file`, true);
        const filename = yamlString(fileNode);
        const content = filename && !/\$|\0/.test(filename) ? readVersionFile(filename) : undefined;
        const version = runtime === 'go' ? content?.match(/^go\s+(\d+\.\d+(?:\.\d+)?)\s*$/m)?.[1] : content?.trim().replace(/^v/, '');
        if (version && actionVersion(version)) {
          deps.push({ name: runtime, spec: version, specRaw: `${filename}: ${version}`, actionRuntime: runtime,
            line: line(fileNode), section: `${section}.with.${config.input}-file` });
        }
        continue;
      }
      // Use the scalar source for numbers: YAML turns unquoted 3.10 into 3.1.
      const spec = yamlString(input) ?? (isScalar(input) && typeof input.value === 'number' ? input.source : undefined);
      const selector = spec && /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(spec);
      const entries = selector && isMap(matrix) ? matrix.get(selector[1], true) : undefined;
      const candidates = isSeq(entries) ? entries.items : [input];
      for (const candidate of candidates) {
        const version = yamlString(candidate) ?? (isScalar(candidate) && typeof candidate.value === 'number' ? candidate.source : undefined);
        if (!version || !actionVersion(version)) continue;
        deps.push({ name: runtime, spec: version, line: line(candidate), section: `${section}.with.${config.input}`, actionRuntime: runtime });
      }
    }
  }
  function steps(node: unknown, section: string, matrix?: unknown): void {
    if (isSeq(node)) for (const step of node.items) uses(step, section, true, matrix);
  }
  const jobs = doc.root.get('jobs', true);
  if (isMap(jobs)) for (const job of jobs.items) {
    if (!isMap(job.value)) continue;
    const section = `jobs.${yamlString(job.key) ?? ''}`;
    uses(job.value, section);
    const strategy = job.value.get('strategy', true);
    steps(job.value.get('steps', true), section, isMap(strategy) ? strategy.get('matrix', true) : undefined);
  }
  const runs = doc.root.get('runs', true);
  if (isMap(runs) && yamlString(runs.get('using', true)) === 'composite') steps(runs.get('steps', true), 'runs.steps');
  return deps;
}
