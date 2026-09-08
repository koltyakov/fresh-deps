import type { AuditResponse } from './types';

/** Audit answers are version-specific and never persisted with registry metadata. */
export class AuditCache {
  private readonly entries = new Map<string, { at: number; result: AuditResponse }>();
  private readonly pending = new Map<string, Promise<AuditResponse>>();

  get(key: string, ttl: number): AuditResponse | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const lifetime = entry.result.status === 'failed' ? Math.min(ttl, 60_000) : ttl;
    return Date.now() - entry.at < lifetime ? entry.result : undefined;
  }

  async resolve(key: string, fetch: () => Promise<AuditResponse>): Promise<AuditResponse> {
    const existing = this.pending.get(key);
    if (existing) return existing;
    const pending = Promise.resolve().then(fetch).catch((error): AuditResponse => ({
      status: 'failed', error: error instanceof Error ? error.message : String(error),
    })).then((result) => {
      if (this.pending.get(key) === pending) {
        this.entries.set(key, { at: Date.now(), result });
        this.pending.delete(key);
      }
      return result;
    });
    this.pending.set(key, pending);
    return pending;
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
  }
}
