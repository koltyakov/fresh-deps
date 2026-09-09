import { isMap } from 'yaml';
import { dockerTag } from '../docker';
import type { DependencyRef } from '../types';
import { yamlDocument, yamlString } from './yaml';

export function imageDependency(image: string, line: number, section: string): DependencyRef | undefined {
  const match = /^(?:docker\.io\/|index\.docker\.io\/)?([a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)?):([^/@\s]+)$/.exec(image);
  if (!match || !dockerTag(match[2])) return undefined;
  // An unqualified first component containing a dot names a registry, not a Hub namespace.
  if (match[1].includes('/') && match[1].split('/')[0].includes('.')) return undefined;
  const name = match[1].includes('/') ? match[1] : `library/${match[1]}`;
  return { name, spec: match[2], line, section };
}

export function parseDockerfile(text: string): DependencyRef[] {
  const deps: DependencyRef[] = [];
  const stages = new Set<string>();
  const lines = text.split(/\r?\n/);
  const heredocs: string[] = [];
  for (let line = 0; line < lines.length; line++) {
    const raw = lines[line];
    if (heredocs.length) { if (raw.trim() === heredocs[0]) heredocs.shift(); continue; }
    if (/^\s*#/.test(raw)) continue;
    let instruction = raw;
    while (/[\\`]\s*$/.test(instruction) && line + 1 < lines.length) {
      instruction = instruction.replace(/[\\`]\s*$/, '') + ' ' + lines[++line].trim();
    }
    if (/^\s*(?:RUN|COPY|ADD)\s/i.test(instruction)) {
      heredocs.push(...[...instruction.matchAll(/<<-?['"]?(\w+)['"]?/g)].map((match) => match[1]));
      continue;
    }
    const match = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+([\w.-]+))?\s*$/i.exec(instruction);
    if (!match) continue;
    if (!stages.has(match[1].toLowerCase())) {
      const dep = imageDependency(match[1], line, 'FROM');
      if (dep) deps.push(dep);
    }
    if (match[2]) stages.add(match[2].toLowerCase());
  }
  return deps;
}

export function parseCompose(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  const services = doc?.root.get('services', true);
  if (!doc || !isMap(services)) return [];
  const deps: DependencyRef[] = [];
  for (const service of services.items) {
    if (!isMap(service.value)) continue;
    const node = service.value.get('image', true);
    const image = yamlString(node);
    const dep = image && imageDependency(image, doc.line(node), 'services');
    if (dep) deps.push(dep);
  }
  return deps;
}
