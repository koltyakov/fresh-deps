import { fetchJson } from '../http';
import type { AuditResponse, Ecosystem, SecurityAdvisory } from '../types';

const ecosystems: Partial<Record<Ecosystem, string>> = {
  npm: 'npm', python: 'PyPI', go: 'Go', rust: 'crates.io', java: 'Maven', gradle: 'Maven',
  scala: 'Maven', clojure: 'Maven', dotnet: 'NuGet', php: 'Packagist', ruby: 'RubyGems', dart: 'Pub', elixir: 'Hex',
};

export async function osvAudit(ecosystem: Ecosystem, name: string, version: string, timeoutMs: number): Promise<AuditResponse> {
  if (ecosystem === 'deno' && name.startsWith('npm:')) {
    ecosystem = 'npm';
    name = name.slice(4);
  }
  const mapped = ecosystems[ecosystem];
  if (!mapped) return { status: 'unsupported' };
  const doc = await fetchJson<{ vulns?: OsvVulnerability[] }>('https://api.osv.dev/v1/query', {
    timeoutMs, method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ package: { ecosystem: mapped, name }, version }),
  });
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || (doc.vulns !== undefined && !Array.isArray(doc.vulns))) throw new Error('Invalid OSV response');
  return { status: 'checked', advisories: (doc.vulns ?? []).flatMap((vuln) => parseAdvisory(vuln, mapped, name)) };
}

interface OsvVulnerability {
  id: string;
  summary?: string;
  details?: string;
  withdrawn?: string;
  database_specific?: { severity?: string };
  severity?: { type: string; score: string }[];
  affected?: {
    package?: { ecosystem?: string; name?: string };
    database_specific?: { severity?: string };
    severity?: { type: string; score: string }[];
    ranges?: { type: string; repo?: string; events: Record<string, string>[] }[];
  }[];
}

function parseAdvisory(vuln: OsvVulnerability, ecosystem: string, name: string): SecurityAdvisory[] {
  if (!vuln || typeof vuln.id !== 'string' || !vuln.id.trim()
    || vuln.summary != null && typeof vuln.summary !== 'string' || vuln.details != null && typeof vuln.details !== 'string'
    || vuln.withdrawn != null && typeof vuln.withdrawn !== 'string') throw new Error('Invalid OSV advisory');
  if (vuln.withdrawn) return [];
  if (vuln.affected !== undefined && !Array.isArray(vuln.affected)) throw new Error('Invalid OSV affected packages');
  const canonical = (value: string) => ecosystem === 'PyPI' ? value.toLowerCase().replace(/[-_.]+/g, '-') : value;
  const matching = (vuln.affected ?? []).filter((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.package?.ecosystem !== 'string' || typeof entry.package.name !== 'string') throw new Error('Invalid OSV affected package');
    return entry.package?.ecosystem === ecosystem && typeof entry.package.name === 'string' && canonical(entry.package.name) === canonical(name);
  });
  if (vuln.affected?.length && !matching.length) return [];
  const scores = [...vuln.severity ?? [], ...matching.flatMap((entry) => entry.severity ?? [])];
  if (scores.some((score) => !score || typeof score.type !== 'string' || typeof score.score !== 'string')) throw new Error('Invalid OSV severity');
  const affected: NonNullable<SecurityAdvisory['affected']> = [];
  for (const entry of matching) {
    if (entry.ranges !== undefined && !Array.isArray(entry.ranges)) throw new Error('Invalid OSV ranges');
    for (const range of entry.ranges ?? []) {
      if (!range || typeof range.type !== 'string' || !Array.isArray(range.events)
        || range.repo !== undefined && typeof range.repo !== 'string'
        || range.events.some((event) => !event || typeof event !== 'object' || Array.isArray(event)
          || Object.keys(event).length !== 1 || Object.entries(event).some(([key, value]) => !['introduced', 'fixed', 'last_affected', 'limit'].includes(key) || typeof value !== 'string'))) throw new Error('Invalid OSV range');
      affected.push({ type: range.type, ...(range.repo ? { repo: range.repo } : {}), events: range.events });
    }
  }
  const severity = vuln.database_specific?.severity ?? matching.find((entry) => entry.database_specific?.severity)?.database_specific?.severity;
  if (severity !== undefined && typeof severity !== 'string') throw new Error('Invalid OSV severity label');
  return [{ id: vuln.id, title: vuln.summary || vuln.details || vuln.id, url: `https://osv.dev/vulnerability/${encodeURIComponent(vuln.id)}`,
    ...(severity ? { severity } : {}), ...(scores.length ? { scores } : {}), ...(affected.length ? { affected } : {}) }];
}
