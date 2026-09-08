import * as vscode from 'vscode';
import type { DependencyUpdate, Ecosystem, UpdateKind } from './types';

const KINDS: UpdateKind[] = ['major', 'minor', 'patch', 'prerelease'];

/**
 * Comment syntax of each manifest, so a hint is indistinguishable from a comment
 * someone typed there themselves.
 */
const COMMENT_TOKEN: Record<Ecosystem, string> = {
  npm: '//',
  go: '//',
};

/**
 * Shared look for both halves of a hint: lighter than the surrounding code and
 * muted, so it reads as an annotation rather than as part of the manifest. The
 * decoration API exposes no opacity, so it rides along on textDecoration, which
 * VSCode inlines into the generated rule verbatim.
 */
const ANNOTATION = {
  // Exactly one character of separation, the way a trailing comment is spaced in
  // every language that is not Python.
  margin: '0 0 0 1ch',
  fontStyle: 'italic',
  fontWeight: '300',
  textDecoration: 'none; opacity: 0.7',
} as const;

/**
 * The comment token is drawn as a `before` attachment and the version as an
 * `after` one, which is what lets the two carry different colours: the token
 * stays the neutral grey of a real comment while the version keeps its severity
 * hue. Both hang off a single decoration type, so `before` is guaranteed to
 * render ahead of `after` rather than depending on decoration ordering.
 */
function decorationFor(kind: UpdateKind): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    before: { ...ANNOTATION, color: new vscode.ThemeColor('freshDeps.commentForeground') },
    after: { ...ANNOTATION, color: new vscode.ThemeColor(`freshDeps.${kind}Foreground`) },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

export class DecorationRenderer implements vscode.Disposable {
  private readonly types = new Map<UpdateKind, vscode.TextEditorDecorationType>(
    KINDS.map((kind) => [kind, decorationFor(kind)]),
  );

  render(editor: vscode.TextEditor, updates: DependencyUpdate[], ecosystem: Ecosystem): void {
    const byKind = new Map<UpdateKind, vscode.DecorationOptions[]>(KINDS.map((kind) => [kind, []]));
    const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;

    // Hints line up on a common column within each block, the way trailing
    // comments are aligned by hand. Only decorated lines count towards the
    // column, so one long untouched dependency cannot push every hint right.
    const lineWidth = new Map<number, number>();
    const columnOf = new Map<string, number>();
    for (const update of updates) {
      const text = lineTextAt(editor, update.dep.line);
      const width = visualWidth(text, tabSize);
      lineWidth.set(update.dep.line, width);
      columnOf.set(update.dep.section, Math.max(columnOf.get(update.dep.section) ?? 0, width));
    }

    for (const update of updates) {
      // Anchored at the end of the line so the hint trails the whole declaration —
      // past the closing comma or an existing comment — and reads as one.
      const line = editor.document.lineAt(Math.min(update.dep.line, editor.document.lineCount - 1));
      const padding = (columnOf.get(update.dep.section) ?? 0) - (lineWidth.get(update.dep.line) ?? 0);
      byKind.get(update.kind)?.push({
        range: new vscode.Range(line.range.end, line.range.end),
        renderOptions: {
          before: { contentText: COMMENT_TOKEN[ecosystem], margin: `0 0 0 ${padding + 1}ch` },
          after: { contentText: version(update, ecosystem) },
        },
        hoverMessage: hover(update, ecosystem),
      });
    }

    for (const [kind, type] of this.types) {
      editor.setDecorations(type, byKind.get(kind) ?? []);
    }
  }

  clear(editor: vscode.TextEditor): void {
    for (const type of this.types.values()) {
      editor.setDecorations(type, []);
    }
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.types.clear();
  }
}

function lineTextAt(editor: vscode.TextEditor, line: number): string {
  return editor.document.lineAt(Math.min(line, editor.document.lineCount - 1)).text;
}

/** Columns a line occupies on screen, expanding tabs the way the editor draws them. */
function visualWidth(text: string, tabSize: number): number {
  let width = 0;
  for (const char of text) {
    width = char === '\t' ? width + tabSize - (width % tabSize) : width + 1;
  }
  return width;
}

function display(version: string, ecosystem: Ecosystem): string {
  return ecosystem === 'go' && !version.startsWith('v') ? `v${version}` : version;
}

function version(update: DependencyUpdate, ecosystem: Ecosystem): string {
  const latest = display(update.latestRaw ?? update.latest, ecosystem);
  if (update.satisfying) {
    return `↑ ${display(update.satisfying, ecosystem)} → ${latest}`;
  }
  if (update.alternatePath) {
    return `↑ ${latest} (${majorSuffix(update.alternatePath)})`;
  }
  return `↑ ${latest}`;
}

/** The `/v3` or `.v3` tail a Go module gained, or the whole path if it is neither. */
function majorSuffix(modulePath: string): string {
  return modulePath.match(/(\/v\d+)$/)?.[1] ?? modulePath.match(/(\.v\d+)$/)?.[1] ?? modulePath;
}

function hover(update: DependencyUpdate, ecosystem: Ecosystem): vscode.MarkdownString {
  const md = new vscode.MarkdownString();
  md.supportThemeIcons = true;

  const name = update.alternatePath ?? update.dep.name;
  md.appendMarkdown(`**${name}** — ${update.kind} update available\n\n`);
  md.appendMarkdown(`| | |\n|---|---|\n`);
  md.appendMarkdown(`| Declared | \`${update.dep.spec}\` |\n`);
  md.appendMarkdown(`| Latest | \`${display(update.latestRaw ?? update.latest, ecosystem)}\` |\n`);
  if (update.satisfying) {
    md.appendMarkdown(`| Newest in range | \`${display(update.satisfying, ecosystem)}\` |\n`);
  } else if (!update.inRange && ecosystem === 'npm') {
    md.appendMarkdown(`| In range | no — the range needs to be widened |\n`);
  }
  if (update.dep.alias) {
    md.appendMarkdown(`| Aliased as | \`${update.dep.alias}\` |\n`);
  }
  if (update.alternatePath) {
    md.appendMarkdown(`| New import path | \`${update.alternatePath}\` |\n`);
  }

  md.appendMarkdown(`\n${links(update, ecosystem)}`);
  return md;
}

function links(update: DependencyUpdate, ecosystem: Ecosystem): string {
  if (ecosystem === 'npm') {
    const name = update.dep.name;
    return `[npm](https://www.npmjs.com/package/${name}/v/${update.latest})`;
  }
  const modulePath = update.alternatePath ?? update.dep.name;
  return `[pkg.go.dev](https://pkg.go.dev/${modulePath}@v${update.latest})`;
}
