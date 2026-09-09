import * as vscode from 'vscode';
import { readSettingsFrom, type Settings } from './settings';

export type { Settings } from './settings';

export function readSettings(scope?: vscode.Uri): Settings {
  const cfg = vscode.workspace.getConfiguration('freshDeps', scope ?? null);
  return readSettingsFrom(<T>(key: string) => cfg.get<T>(key));
}
