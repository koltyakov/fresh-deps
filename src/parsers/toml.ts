/**
 * Tolerant, position-aware TOML scanner.
 *
 * Only what is needed to find dependency declarations and the line each one
 * sits on: table headers, dotted keys, strings, arrays and inline tables.
 * Numbers, booleans and dates are recognised only well enough to be skipped,
 * and a malformed document degrades to fewer entries rather than to an error.
 */

export type TomlValue =
  | { kind: 'string'; text: string; line: number }
  | { kind: 'array'; items: TomlValue[]; line: number }
  | { kind: 'table'; entries: TomlEntry[]; line: number }
  | { kind: 'other'; line: number };

export interface TomlEntry {
  /** Dotted key path, table header included: `['project', 'dependencies']`. */
  path: string[];
  value: TomlValue;
  /** Zero-based line the key sits on. */
  line: number;
}

class Scanner {
  private i = 0;
  private line = 0;

  constructor(private readonly text: string) {}

  private peek(offset = 0): string | undefined {
    return this.text[this.i + offset];
  }

  private advance(count = 1): void {
    for (let n = 0; n < count; n++) {
      if (this.text[this.i] === '\n') {
        this.line++;
      }
      this.i++;
    }
  }

  private skipSpaces(): void {
    while (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\r') {
      this.advance();
    }
  }

  private skipTrivia(): void {
    for (;;) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }
      if (ch === '#') {
        while (this.peek() !== undefined && this.peek() !== '\n') {
          this.advance();
        }
        continue;
      }
      return;
    }
  }

  private skipLine(): void {
    while (this.peek() !== undefined && this.peek() !== '\n') {
      this.advance();
    }
  }

  private readString(): string {
    const quote = this.peek() as string;
    const triple = this.peek(1) === quote && this.peek(2) === quote;
    const literal = quote === "'";
    this.advance(triple ? 3 : 1);

    let out = '';
    for (;;) {
      const ch = this.peek();
      if (ch === undefined || (!triple && ch === '\n')) {
        break;
      }
      if (ch === quote) {
        if (!triple) {
          this.advance();
          break;
        }
        if (this.peek(1) === quote && this.peek(2) === quote) {
          this.advance(3);
          break;
        }
      }
      if (!literal && ch === '\\') {
        const escaped = this.peek(1);
        out += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped === 'r' ? '\r' : escaped ?? '';
        this.advance(2);
        continue;
      }
      out += ch;
      this.advance();
    }
    return out;
  }

  /** Reads a dotted key, stopping at `stop`, a newline or anything unexpected. */
  private readKeyPath(stop: string): string[] {
    const parts: string[] = [];

    for (;;) {
      this.skipSpaces();
      const ch = this.peek();
      if (ch === undefined || ch === '\n' || ch === stop) {
        break;
      }

      if (ch === '"' || ch === "'") {
        parts.push(this.readString());
      } else {
        let bare = '';
        while (this.peek() !== undefined && /[A-Za-z0-9_-]/.test(this.peek() as string)) {
          bare += this.peek();
          this.advance();
        }
        if (bare === '') {
          break;
        }
        parts.push(bare);
      }

      this.skipSpaces();
      if (this.peek() === '.') {
        this.advance();
        continue;
      }
      break;
    }

    return parts;
  }

  private readValue(): TomlValue {
    this.skipSpaces();
    const line = this.line;
    const ch = this.peek();

    if (ch === '"' || ch === "'") {
      return { kind: 'string', text: this.readString(), line };
    }

    if (ch === '[') {
      this.advance();
      const items: TomlValue[] = [];
      for (;;) {
        this.skipTrivia();
        const next = this.peek();
        if (next === undefined) {
          break;
        }
        if (next === ']') {
          this.advance();
          break;
        }
        if (next === ',') {
          this.advance();
          continue;
        }
        const before = this.i;
        items.push(this.readValue());
        if (this.i === before) {
          this.advance();
        }
      }
      return { kind: 'array', items, line };
    }

    if (ch === '{') {
      this.advance();
      const entries: TomlEntry[] = [];
      for (;;) {
        this.skipTrivia();
        const next = this.peek();
        if (next === undefined) {
          break;
        }
        if (next === '}') {
          this.advance();
          break;
        }
        if (next === ',') {
          this.advance();
          continue;
        }
        const keyLine = this.line;
        const before = this.i;
        const path = this.readKeyPath('=');
        if (this.peek() === '=') {
          this.advance();
          entries.push({ path, value: this.readValue(), line: keyLine });
        } else if (this.i === before) {
          this.advance();
        }
      }
      return { kind: 'table', entries, line };
    }

    while (![undefined, '\n', ',', ']', '}', '#'].includes(this.peek())) {
      this.advance();
    }
    return { kind: 'other', line };
  }

  scan(): TomlEntry[] {
    const entries: TomlEntry[] = [];
    let header: string[] = [];

    for (;;) {
      this.skipTrivia();
      if (this.peek() === undefined) {
        return entries;
      }

      if (this.peek() === '[') {
        this.advance();
        if (this.peek() === '[') {
          this.advance();
        }
        header = this.readKeyPath(']');
        while (this.peek() === ']') {
          this.advance();
        }
        this.skipLine();
        continue;
      }

      const keyLine = this.line;
      const before = this.i;
      const path = this.readKeyPath('=');
      if (path.length === 0 || this.peek() !== '=') {
        if (this.i === before) {
          this.advance();
        }
        this.skipLine();
        continue;
      }

      this.advance(); // '='
      entries.push({ path: [...header, ...path], value: this.readValue(), line: keyLine });
    }
  }
}

export function scanToml(text: string): TomlEntry[] {
  return new Scanner(text).scan();
}

/** The string a value holds, for a plain string or for the `version` of an inline table. */
export function versionOf(value: TomlValue): { text: string; line: number } | undefined {
  if (value.kind === 'string') {
    return { text: value.text, line: value.line };
  }
  if (value.kind === 'table') {
    const version = value.entries.find((entry) => entry.path.length === 1 && entry.path[0] === 'version');
    if (version?.value.kind === 'string') {
      return { text: version.value.text, line: version.value.line };
    }
  }
  return undefined;
}
