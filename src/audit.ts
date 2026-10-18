import type { AuditResponse } from './types';
import { SharedRequests } from './requests';

/** Audit answers are version-specific and never persisted with registry metadata. */
export class AuditCache {
  private readonly entries = new Map<string, { at: number; result: AuditResponse }>();
  private readonly pending = new SharedRequests<AuditResponse>();
  private generation = 0;

  get(key: string, ttl: number): AuditResponse | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    const lifetime = entry.result.status === 'failed' ? Math.min(ttl, 60_000) : ttl;
    return Date.now() - entry.at < lifetime ? entry.result : undefined;
  }

  resolve(key: string, fetch: () => Promise<AuditResponse>, signal?: AbortSignal): Promise<AuditResponse> {
    const generation = this.generation;
    return this.pending.resolve(key, async (requestSignal) => {
      let result: AuditResponse;
      try { result = await fetch(); }
      catch (error) {
        requestSignal.throwIfAborted();
        result = { status: 'failed', error: error instanceof Error ? error.message : String(error) };
      }
      if (!requestSignal.aborted && generation === this.generation) this.entries.set(key, { at: Date.now(), result });
      return result;
    }, signal);
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.generation++;
  }
}
