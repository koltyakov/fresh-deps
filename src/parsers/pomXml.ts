import * as mavenVersion from '../mavenVersion';
import type { DependencyRef } from '../types';

interface Element {
  name: string;
  line: number;
  text: string;
  children: Element[];
  parent?: Element;
}

function parseXml(text: string): Element {
  const root: Element = { name: '', line: 0, text: '', children: [] };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<[^>]*>|[^<]+/g;
  for (const match of text.matchAll(tokens)) {
    const token = match[0];
    if (!token.startsWith('<')) {
      stack.at(-1)!.text += token;
      continue;
    }
    if (/^<\/?[!?]/.test(token) || token.startsWith('<!--')) continue;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const rawName = token.match(/^<\s*([^\s/>]+)/)?.[1];
    if (!rawName) continue;
    const node: Element = {
      name: rawName.split(':').at(-1)!,
      line: text.slice(0, match.index).split('\n').length - 1,
      text: '',
      children: [],
      parent: stack.at(-1),
    };
    stack.at(-1)!.children.push(node);
    if (!/\/\s*>$/.test(token)) stack.push(node);
  }
  return root;
}

function child(node: Element, name: string): Element | undefined {
  return node.children.find((candidate) => candidate.name === name);
}

function value(node: Element | undefined): string | undefined {
  return node?.text.trim() || undefined;
}

function descendants(node: Element, name: string): Element[] {
  return node.children.flatMap((candidate) => [
    ...(candidate.name === name ? [candidate] : []),
    ...descendants(candidate, name),
  ]);
}

function sectionOf(node: Element): string {
  let current = node.parent;
  while (current) {
    if (current.name === 'dependencyManagement') return 'dependencyManagement';
    current = current.parent;
  }
  return 'dependencies';
}

/** Reads dependencies with explicit versions, including versions stored in `<properties>`. */
export function parsePomXml(text: string): DependencyRef[] {
  const root = parseXml(text);
  const project = descendants(root, 'project')[0] ?? root;
  const properties = new Map<string, string>();
  for (const property of child(project, 'properties')?.children ?? []) {
    const propertyValue = value(property);
    if (propertyValue) properties.set(property.name, propertyValue);
  }

  const parent = child(project, 'parent');
  const projectValues: Record<string, string | undefined> = {
    groupId: value(child(project, 'groupId')) ?? (parent ? value(child(parent, 'groupId')) : undefined),
    artifactId: value(child(project, 'artifactId')),
    version: value(child(project, 'version')) ?? (parent ? value(child(parent, 'version')) : undefined),
  };
  for (const [key, projectValue] of Object.entries(projectValues)) {
    if (!projectValue) continue;
    properties.set(`project.${key}`, projectValue);
    properties.set(`pom.${key}`, projectValue);
  }

  const resolve = (raw: string): string | undefined => {
    let result = raw;
    for (let depth = 0; depth < 10 && result.includes('${'); depth++) {
      result = result.replace(/\$\{([^}]+)}/g, (whole, name: string) => properties.get(name) ?? whole);
    }
    return result.includes('${') ? undefined : result.trim();
  };

  const deps: DependencyRef[] = [];
  for (const dependency of descendants(project, 'dependency')) {
    const groupId = value(child(dependency, 'groupId'));
    const artifactId = value(child(dependency, 'artifactId'));
    const versionNode = child(dependency, 'version');
    const rawVersion = value(versionNode);
    if (!groupId || !artifactId || !rawVersion || !versionNode) continue;
    const resolvedGroup = resolve(groupId);
    const resolvedArtifact = resolve(artifactId);
    const spec = resolve(rawVersion);
    if (!resolvedGroup || !resolvedArtifact || !spec || (!mavenVersion.isValid(spec) && !mavenVersion.isRange(spec))) continue;
    deps.push({
      name: `${resolvedGroup}:${resolvedArtifact}`,
      spec,
      line: versionNode.line,
      section: sectionOf(dependency),
    });
  }
  return deps;
}
