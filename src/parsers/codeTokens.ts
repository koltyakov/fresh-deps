/** Small literal-only lexer shared by build-script readers. No code is evaluated. */
export interface CodeToken { value: string; kind: 'string' | 'word' | 'punct'; line: number; start: number; end: number }

export function codeTokens(text: string, dialect: 'c' | 'python' | 'clojure' = 'c'): CodeToken[] {
  const tokens: CodeToken[] = [];
  let i = 0;
  let line = 0;
  const advance = () => { if (text[i++] === '\n') line++; };
  while (i < text.length) {
    if (/\s/.test(text[i])) { advance(); continue; }
    if ((dialect === 'c' && text.startsWith('//', i)) || (dialect === 'python' && text[i] === '#')
      || (dialect === 'clojure' && text[i] === ';')) {
      while (i < text.length && text[i] !== '\n') advance();
      continue;
    }
    if (dialect === 'c' && text.startsWith('/*', i)) {
      let depth = 1; i += 2;
      while (i < text.length && depth) {
        if (text.startsWith('/*', i)) { depth++; i += 2; }
        else if (text.startsWith('*/', i)) { depth--; i += 2; }
        else advance();
      }
      continue;
    }
    const start = i;
    const startLine = line;
    if (text[i] === '"' || (dialect === 'python' && text[i] === "'")) {
      const quote = text[i];
      const triple = text.startsWith(quote.repeat(3), i);
      const delimiter = triple ? quote.repeat(3) : quote;
      i += delimiter.length;
      let value = '';
      let literal = !triple;
      while (i < text.length && !text.startsWith(delimiter, i)) {
        if (text[i] === '\\') { literal = false; advance(); if (i < text.length) advance(); }
        else { value += text[i]; advance(); }
      }
      if (i >= text.length) break;
      i += delimiter.length;
      if (literal) tokens.push({ value, kind: 'string', line: startLine, start, end: i });
      else tokens.push({ value: '', kind: 'word', line: startLine, start, end: i });
      continue;
    }
    const word = /^[A-Za-z_][\w-]*/.exec(text.slice(i));
    if (word) i += word[0].length;
    else i++;
    tokens.push({ value: text.slice(start, i), kind: word ? 'word' : 'punct', line: startLine, start, end: i });
  }
  return tokens;
}

export function groupEnd(tokens: CodeToken[], open: number): number {
  const pairs: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
  const stack: string[] = [];
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i].kind === 'string') continue;
    const value = tokens[i].value;
    if (pairs[value]) stack.push(pairs[value]);
    else if ([')', ']', '}'].includes(value)) {
      if (stack.pop() !== value) return -1;
      if (!stack.length) return i;
    }
  }
  return -1;
}
