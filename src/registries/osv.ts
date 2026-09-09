import { fetchJson } from '../http';
import type { AuditResponse, Ecosystem } from '../types';

const ecosystems: Partial<Record<Ecosystem, string>> = {
  npm: 'npm', python: 'PyPI', go: 'Go', rust: 'crates.io', java: 'Maven', gradle: 'Maven',
  scala: 'Maven', clojure: 'Maven', dotnet: 'NuGet', php: 'Packagist', ruby: 'RubyGems', dart: 'Pub', elixir: 'Hex',
};

export async function osvAudit(ecosystem: Ecosystem, name: string, version: string, timeoutMs: number): Promise<AuditResponse> {
  const mapped = ecosystems[ecosystem];
  if (!mapped) return { status: 'unsupported' };
  const doc = await fetchJson<{ vulns?: { id: string; summary?: string; details?: string; withdrawn?: string; references?: { url: string }[] }[] }>('https://api.osv.dev/v1/query', {
    timeoutMs, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { ecosystem: mapped, name }, version }),
  });
  if (!doc || typeof doc !== 'object' || (doc.vulns !== undefined && !Array.isArray(doc.vulns))) throw new Error('Invalid OSV response');
  return { status: 'checked', advisories: (doc.vulns ?? []).filter((vuln) => !vuln.withdrawn).map((vuln) => {
    if (typeof vuln.id !== 'string') throw new Error('Invalid OSV advisory');
    return { id: vuln.id, title: vuln.summary || vuln.details || vuln.id, url: `https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}` };
  }) };
}
