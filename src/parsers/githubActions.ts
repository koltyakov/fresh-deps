import { isMap, isScalar, isSeq } from 'yaml';
import { actionRuntimes, actionVersion } from '../githubActions';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function parseGithubActions(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const line = doc.line;
  const deps: DependencyRef[] = [];
  function uses(node: unknown, section: string, setup = false): void {
    if (!isMap(node)) return;
    const value = node.get('uses', true);
    const raw = yamlString(value);
    const match = raw && /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/[^@\s]+)?@([^\s]+)$/.exec(raw);
    if (!match || match[1].split('/').some((part) => /^\.+$/.test(part))) return;
    if (actionVersion(match[3])) {
      deps.push({ name: match[1], spec: match[3], line: line(value), section,
        ...(match[2] ? { alias: match[1] + match[2] } : {}) });
    }
    // Inputs also work when the setup action itself is pinned to a SHA or branch.
    if (!setup || match[2]) return;
    const inputs = node.get('with', true);
    if (!isMap(inputs)) return;
    for (const runtime of Object.keys(actionRuntimes) as NonNullable<DependencyRef['actionRuntime']>[]) {
      const config = actionRuntimes[runtime];
      if (match[1].toLowerCase() !== config.action) continue;
      const input = inputs.get(config.input, true);
      // Use the scalar source for numbers: YAML turns unquoted 3.10 into 3.1.
      const spec = yamlString(input) ?? (isScalar(input) && typeof input.value === 'number' ? input.source : undefined);
      if (!spec || !actionVersion(spec)) continue;
      deps.push({ name: runtime, spec, line: line(input), section: `${section}.with.${config.input}`, actionRuntime: runtime });
    }
  }
  function steps(node: unknown, section: string): void {
    if (isSeq(node)) for (const step of node.items) uses(step, section, true);
  }
  const jobs = doc.root.get('jobs', true);
  if (isMap(jobs)) for (const job of jobs.items) {
    if (!isMap(job.value)) continue;
    const section = `jobs.${yamlString(job.key) ?? ''}`;
    uses(job.value, section);
    steps(job.value.get('steps', true), section);
  }
  const runs = doc.root.get('runs', true);
  if (isMap(runs) && yamlString(runs.get('using', true)) === 'composite') steps(runs.get('steps', true), 'runs.steps');
  return deps;
}
