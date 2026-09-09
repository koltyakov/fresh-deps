import { isMap, isSeq } from 'yaml';
import { actionVersion } from '../githubActions';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function parseGithubActions(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const line = doc.line;
  const deps: DependencyRef[] = [];
  function uses(node: unknown, section: string): void {
    if (!isMap(node)) return;
    const value = node.get('uses', true);
    const raw = yamlString(value);
    const match = raw && /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(\/[^@\s]+)?@([^\s]+)$/.exec(raw);
    if (!match || !actionVersion(match[3]) || match[1].split('/').some((part) => /^\.+$/.test(part))) return;
    deps.push({ name: match[1], spec: match[3], line: line(value), section,
      ...(match[2] ? { alias: match[1] + match[2] } : {}) });
  }
  function steps(node: unknown, section: string): void {
    if (isSeq(node)) for (const step of node.items) uses(step, section);
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
