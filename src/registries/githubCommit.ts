import { fetchJson } from '../http';
import type { RegistryVersions } from '../types';

/** A commit pin can advance only along the repository's default-branch history. */
export async function githubCommitVersions(repository: string, sha: string, timeoutMs: number): Promise<RegistryVersions> {
  const base = `https://api.github.com/repos/${repository}`;
  const source = `https://github.com/${repository}`;
  const options = { timeoutMs };
  const repo = await fetchJson<{ default_branch?: string }>(base, options);
  if (!repo) return { source, error: 'GitHub repository was not found or is inaccessible' };
  if (typeof repo.default_branch !== 'string' || !repo.default_branch) throw new Error('Invalid GitHub default branch response');
  const tip = await fetchJson<{ sha?: string }>(`${base}/commits/${encodeURIComponent(repo.default_branch)}`, options);
  if (!tip?.sha || !/^[a-f\d]{40}$/i.test(tip.sha)) throw new Error('Unable to resolve GitHub default branch tip');
  const latest = tip.sha.toLowerCase();
  const evidence: RegistryVersions = { source, githubDefaultBranch: repo.default_branch, meta: { repository: source } };
  if (latest.startsWith(sha.toLowerCase())) return { ...evidence, published: [sha] };
  // Compare immutable commits so a branch move between requests cannot change the target.
  const comparison = await fetchJson<{ status?: string; base_commit?: { sha?: string } }>(
    `${base}/compare/${sha}...${latest}`, options);
  if (!comparison) return { ...evidence, error: 'Unable to compare the pinned SHA with the default branch' };
  if (!['ahead', 'behind', 'diverged', 'identical'].includes(comparison.status ?? '')
    || !/^[a-f\d]{40}$/i.test(comparison.base_commit?.sha ?? '')
    || !comparison.base_commit!.sha!.toLowerCase().startsWith(sha.toLowerCase())) {
    throw new Error('Invalid GitHub commit comparison response');
  }
  return { ...evidence, published: [sha], ...(comparison.status === 'ahead' ? { latest } : {}) };
}
