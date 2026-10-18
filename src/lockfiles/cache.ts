const parsed = new Map<string, { text: string; value: unknown }>();
const MAX_ENTRIES = 8;

/** Bounded, memory-only parse reuse. Callers reread files and must not mutate cached values. */
export function cachedLockfile<T>(key: string, text: string, parse: () => T): T {
  const entry = parsed.get(key);
  if (entry?.text === text) return entry.value as T;
  const value = parse();
  parsed.delete(key);
  if (parsed.size >= MAX_ENTRIES) parsed.delete(parsed.keys().next().value!);
  parsed.set(key, { text, value });
  return value;
}

export function clearLockfileCache(): void {
  parsed.clear();
}
