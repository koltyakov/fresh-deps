import type { RegistryVersions } from './types';
import { SharedRequests } from './requests';

interface Entry {
  value: RegistryVersions;
  at: number;
  expires: number;
}

/** Short TTL for failures, so a flaky network does not hide updates for an hour. */
const ERROR_TTL_MS = 5 * 60 * 1000;

export class VersionCache {
  private entries = new Map<string, Entry>();
  private pending = new SharedRequests<RegistryVersions>();
  generation = 0;

  /** Share requests across declarations and editors without sharing comparison policy. */
  resolve(
    key: string,
    fetch: () => Promise<RegistryVersions>,
    signal?: AbortSignal
  ): Promise<RegistryVersions> {
    return this.pending.resolve(key, fetch, signal);
  }

  constructor(private ttlMs: number) {}

  setTtl(ttlMs: number): void {
    if (ttlMs !== this.ttlMs) this.clear();
    this.ttlMs = ttlMs;
  }

  get(key: string): RegistryVersions | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (Math.min(entry.expires, entry.at + this.ttlMs) <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: RegistryVersions): void {
    const ttl =
      value.error || value.packageMissing ? Math.min(ERROR_TTL_MS, this.ttlMs) : this.ttlMs;
    const at = Date.now();
    this.entries.set(key, { value, at, expires: at + ttl });
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.generation++;
  }

  /** Serialisable snapshot, used to keep resolved versions across window reloads. */
  serialize(): [string, Entry][] {
    const now = Date.now();
    return [...this.entries].filter(
      ([, entry]) => entry.expires > now && !entry.value.error && !entry.value.packageMissing
    );
  }

  restore(data: [string, Entry][] | undefined): void {
    if (!Array.isArray(data)) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of data) {
      // Old snapshots without a fetch timestamp cannot honor a shorter current TTL.
      if (Number.isFinite(entry?.at) && Math.min(entry.expires, entry.at + this.ttlMs) > now) {
        this.entries.set(key, entry);
      }
    }
  }
}
