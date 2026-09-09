import { isSeq } from 'yaml';
import { condaScheme } from '../numericVersion';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function condaChannel(channel: string): boolean {
  return /^[a-zA-Z0-9][\w-]*$/.test(channel) && !['defaults', 'nodefaults', 'local'].includes(channel);
}

export function parseConda(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  const channelNodes = doc.root.get('channels', true);
  const channels = isSeq(channelNodes) ? channelNodes.items.map(yamlString) : [];
  const configured = channels.filter((channel) => channel !== 'nodefaults');
  const usable = configured.length && configured.every((channel) => channel && condaChannel(channel));
  const entries = doc.root.get('dependencies', true);
  if (!isSeq(entries)) return [];
  return entries.items.flatMap((entry) => {
    const value = yamlString(entry);
    const match = value && /^(?:([\w-]+)::)?([a-zA-Z0-9_][\w.-]*)\s*([=<>!].*|\d.*)$/.exec(value.trim());
    if (!match || (match[1] ? !condaChannel(match[1]) : !usable)) return [];
    const spec = match[3].replace(/\s+/g, '');
    if (!condaScheme.baseline(spec)) return [];
    return [{ name: match[2], spec, source: match[1] ?? configured.join('|'), line: doc.line(entry), section: 'dependencies' }];
  });
}
