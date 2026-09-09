import type { RegistryVersions } from './types';

interface Entry {
  value: RegistryVersions;
  expires: number;
}

/** Short TTL for failures, so a flaky network does not hide updates for an hour. */
const ERROR_TTL_MS = 5 * 60 * 1000;

export class VersionCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<RegistryVersions>>();
  generation = 0;

  /** Share requests across declarations and editors without sharing comparison policy. */
  resolve(key: string, fetch: () => Promise<RegistryVersions>): Promise<RegistryVersions> {
    let pending = this.pending.get(key);
    if (!pending) {
      pending = Promise.resolve().then(fetch).finally(() => {
        if (this.pending.get(key) === pending) this.pending.delete(key);
      });
      this.pending.set(key, pending);
    }
    return pending;
  }

  constructor(private ttlMs: number) {}

  setTtl(ttlMs: number): void {
    this.ttlMs = ttlMs;
  }

  get(key: string): RegistryVersions | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: RegistryVersions): void {
    const ttl = value.error ? Math.min(ERROR_TTL_MS, this.ttlMs) : this.ttlMs;
    this.entries.set(key, { value, expires: Date.now() + ttl });
  }

  clear(): void {
    this.entries.clear();
    this.pending.clear();
    this.generation++;
  }

  /** Serialisable snapshot, used to keep resolved versions across window reloads. */
  serialize(): [string, Entry][] {
    const now = Date.now();
    return [...this.entries].filter(([, entry]) => entry.expires > now && !entry.value.error);
  }

  restore(data: [string, Entry][] | undefined): void {
    if (!Array.isArray(data)) {
      return;
    }
    const now = Date.now();
    for (const [key, entry] of data) {
      if (entry?.expires > now) {
        this.entries.set(key, entry);
      }
    }
  }
}
