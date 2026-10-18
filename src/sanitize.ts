/** Browser links and exported sources must not expose credentials or executable schemes. */
export function safeUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol)) return undefined;
    url.username = '';
    url.password = '';
    // Snapshot keys before deleting. Iterating live search params can skip credentials.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const key of [...url.searchParams.keys()]) {
      if (/token|secret|password|credential|auth|api[-_]?key|signature|^sig$|^key$/i.test(key))
        url.searchParams.delete(key);
    }
    if (/token|secret|password|credential|auth|api[-_]?key|signature/i.test(url.hash))
      url.hash = '';
    return url.href.replace(
      /[<>|()]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`
    );
  } catch {
    return undefined;
  }
}

export function redact(value: string): string {
  return value
    .replace(/(?:https?:\/\/)[^\s<>"'`]+/gi, (url) => safeUrl(url) ?? '[redacted URL]')
    .replace(
      /((?:token|password|secret|authorization|api[-_]?key)\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?[^\s,;]+/gi,
      '$1[redacted]'
    );
}
