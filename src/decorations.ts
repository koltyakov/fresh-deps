import * as vscode from 'vscode';
import { display } from './format';
import type { DependencyAudit, DependencyUpdate, Ecosystem, UpdateKind } from './types';

type HintKind = UpdateKind | 'audit';
const KINDS: HintKind[] = ['major', 'minor', 'patch', 'prerelease', 'audit'];

/**
 * Comment syntax of each manifest, so a hint is indistinguishable from a comment
 * someone typed there themselves.
 */
const COMMENT_TOKEN: Record<Ecosystem, string> = {
  npm: '//',
  go: '//',
  python: '#',
  rust: '#',
  dotnet: '<!--',
  java: '<!--',
  php: '//',
  dart: '#',
  gradle: '#',
  ruby: '#',
  terraform: '#',
  elixir: '#',
  deno: '//',
  githubActions: '#',
  docker: '#',
  helm: '#',
  swift: '//',
  conan: '#',
  ansible: '#',
  bazel: '#',
  vcpkg: '//',
  scala: '//',
  conda: '#',
  clojure: ';',
};

/**
 * Hints are lighter than the surrounding code and
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
 * The gray marker paints into space reserved by `after`. Its zero width and
 * cancelling margins keep `before` from shifting the line-end caret.
 */
function decorationFor(kind: HintKind): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    before: { ...ANNOTATION, width: '0', color: new vscode.ThemeColor('freshDeps.commentForeground') },
    after: { ...ANNOTATION, color: new vscode.ThemeColor(kind === 'audit' ? 'editorWarning.foreground' : `freshDeps.${kind}Foreground`) },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

export class DecorationRenderer implements vscode.Disposable {
  private readonly types = new Map<HintKind, vscode.TextEditorDecorationType>(
    KINDS.map((kind) => [kind, decorationFor(kind)]),
  );

  render(editor: vscode.TextEditor, updates: DependencyUpdate[], ecosystem: Ecosystem, audits: DependencyAudit[]): void {
    const byKind = new Map<HintKind, vscode.DecorationOptions[]>(KINDS.map((kind) => [kind, []]));
    const hints = updates.map((update) => ({ dep: update.dep, kind: update.kind as HintKind, text: version(update, ecosystem) }));
    for (const audit of audits) {
      if (audit.result.status !== 'checked' || audit.result.advisories.length === 0) continue;
      const count = audit.result.advisories.length;
      const warning = `! ${count} audit warning${count === 1 ? '' : 's'}${audit.baseline ? ' at baseline' : ''}`;
      const hint = hints.find((candidate) => candidate.dep === audit.dep);
      if (hint) {
        hint.kind = 'audit';
        hint.text += ` | ${warning}`;
      } else {
        hints.push({ dep: audit.dep, kind: 'audit', text: warning });
      }
    }
    const tabSize = typeof editor.options.tabSize === 'number' ? editor.options.tabSize : 4;

    // Hints line up on a common column within each block, the way trailing
    // comments are aligned by hand. Only decorated lines count towards the
    // column, so one long untouched dependency cannot push every hint right.
    const lineWidth = new Map<number, number>();
    const columnOf = new Map<string, number>();
    for (const update of hints) {
      const text = lineTextAt(editor, update.dep.line);
      const width = visualWidth(text, tabSize);
      lineWidth.set(update.dep.line, width);
      columnOf.set(update.dep.section, Math.max(columnOf.get(update.dep.section) ?? 0, width));
    }

    for (const update of hints) {
      // Anchored at the end of the line so the hint trails the whole declaration -
      // past the closing comma or an existing comment - and reads as one.
      const line = editor.document.lineAt(Math.min(update.dep.line, editor.document.lineCount - 1));
      const padding = (columnOf.get(update.dep.section) ?? 0) - (lineWidth.get(update.dep.line) ?? 0);
      const file = editor.document.uri.fsPath;
      const token = file.endsWith('pnpm-workspace.yaml') || file.endsWith('.yarnrc.yml') ? '#'
        : ecosystem === 'dotnet' && /(?:^|[/\\])(?:dotnet-tools|global)\.json$/.test(file) ? '//'
        : ecosystem === 'gradle' && /\.gradle(?:\.kts)?$/.test(file) ? '//' : COMMENT_TOKEN[ecosystem];
      byKind.get(update.kind)?.push({
        range: new vscode.Range(line.range.end, line.range.end),
        renderOptions: {
          before: {
            contentText: token,
            margin: `0 -${padding + 1}ch 0 ${padding + 1}ch`,
          },
          after: {
            contentText: update.text + (token === '<!--' ? ' -->' : ''),
            margin: `0 0 0 ${padding + token.length + 2}ch`,
          },
        },
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

function version(update: DependencyUpdate, ecosystem: Ecosystem): string {
  const latest = display(update.latestRaw ?? update.latest, ecosystem);
  if (update.satisfying) {
    return `\u2191 ${display(update.satisfying, ecosystem)} \u2192 ${latest}`;
  }
  if (update.alternatePath) {
    return `\u2191 ${latest} (${majorSuffix(update.alternatePath)})`;
  }
  return `\u2191 ${latest}`;
}

/** The `/v3` or `.v3` tail a Go module gained, or the whole path if it is neither. */
function majorSuffix(modulePath: string): string {
  return modulePath.match(/(\/v\d+)$/)?.[1] ?? modulePath.match(/(\.v\d+)$/)?.[1] ?? modulePath;
}
