import { AsyncLocalStorage } from 'node:async_hooks';

// Registry helpers inherit the signal, including pagination and authentication requests.
const signals = new AsyncLocalStorage<AbortSignal>();

export function currentRequestSignal(): AbortSignal | undefined {
  return signals.getStore();
}

export function requestSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const inherited = currentRequestSignal();
  const sources = [AbortSignal.timeout(timeoutMs)];
  if (inherited) sources.push(inherited);
  if (signal && signal !== inherited) sources.push(signal);
  return sources.length === 1 ? sources[0] : AbortSignal.any(sources);
}

interface Pending<T> {
  controller: AbortController;
  promise: Promise<T>;
  subscribers: number;
  uncancellable: boolean;
  settled: boolean;
}

/** Abort shared work only after its last cancellable subscriber leaves. */
export class SharedRequests<T> {
  private readonly pending = new Map<string, Pending<T>>();

  resolve(
    key: string,
    fetch: (signal: AbortSignal) => Promise<T>,
    signal = currentRequestSignal()
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    let entry = this.pending.get(key);
    if (!entry) {
      const work: Pending<T> = {
        controller: new AbortController(),
        promise: undefined!,
        subscribers: 0,
        uncancellable: false,
        settled: false,
      };
      work.promise = Promise.resolve()
        .then(() => {
          work.controller.signal.throwIfAborted();
          return signals.run(work.controller.signal, () => fetch(work.controller.signal));
        })
        .finally(() => {
          work.settled = true;
          if (this.pending.get(key) === work) this.pending.delete(key);
        });
      this.pending.set(key, work);
      entry = work;
    }
    const work = entry;
    if (!signal) {
      work.uncancellable = true;
      return work.promise;
    }
    work.subscribers++;
    return new Promise<T>((resolve, reject) => {
      let done = false;
      const cleanup = () => {
        if (done) return false;
        done = true;
        work.subscribers--;
        signal.removeEventListener('abort', abort);
        return true;
      };
      const abort = () => {
        if (!cleanup()) return;
        reject(signal.reason);
        if (!work.settled && !work.subscribers && !work.uncancellable) {
          if (this.pending.get(key) === work) this.pending.delete(key);
          work.controller.abort(signal.reason);
        }
      };
      signal.addEventListener('abort', abort, { once: true });
      work.promise.then(
        (value) => {
          if (cleanup()) resolve(value);
        },
        (error) => {
          if (cleanup()) reject(error);
        }
      );
    });
  }

  /** Forget pending work without allowing it to remove a later replacement. */
  clear(): void {
    this.pending.clear();
  }
}
