import { isMap } from 'yaml';
import type { DependencyRef } from '../types';
import { parsePnpmWorkspace } from './pnpmWorkspace';
import { repositoryUrl } from './helm';
import { yamlDocument, yamlString } from './yaml';

export function parseYarnCatalog(text: string): DependencyRef[] {
  const doc = yamlDocument(text);
  if (!doc) return [];
  // Yarn authentication is separate from .npmrc; do not accidentally use a public fallback.
  if (doc.root.has('npmAuthToken') || doc.root.has('npmAuthIdent') || doc.root.has('npmRegistries')) return [];
  const registry = doc.root.get('npmRegistryServer', true);
  const scopes = doc.root.get('npmScopes', true);
  return parsePnpmWorkspace(text).flatMap((dep) => {
    const scope = dep.name.startsWith('@') && isMap(scopes) ? scopes.get(dep.name.slice(1).split('/')[0], true) : undefined;
    if (scope !== undefined && !isMap(scope)) return [];
    if (isMap(scope) && (scope.has('npmAuthToken') || scope.has('npmAuthIdent'))) return [];
    const node = isMap(scope) && scope.has('npmRegistryServer') ? scope.get('npmRegistryServer', true) : registry;
    if (node === undefined) return [dep];
    const source = repositoryUrl(yamlString(node) ?? '');
    return source ? [{ ...dep, source }] : [];
  });
}
