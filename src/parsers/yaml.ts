import { isMap, isScalar, LineCounter, parseDocument, type YAMLMap } from 'yaml';

export function yamlDocument(text: string): { root: YAMLMap; line: (node: unknown) => number } | undefined {
  const counter = new LineCounter();
  const document = parseDocument(text, { lineCounter: counter, version: '1.2', uniqueKeys: true });
  if (document.errors.length || !isMap(document.contents)) return undefined;
  return {
    root: document.contents,
    line: (node) => counter.linePos((node as { range?: number[] } | null)?.range?.[0] ?? 0).line - 1,
  };
}

export function yamlString(node: unknown): string | undefined {
  return isScalar(node) && typeof node.value === 'string' ? node.value : undefined;
}
