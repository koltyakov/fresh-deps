import manifest from '../package.json';
import { readSettingsFrom, type Settings } from '../src/settings';

export const configurationProperties = Object.assign({},
  ...manifest.contributes.configuration.map((group) => group.properties),
) as Record<string, { default: unknown }>;

type SettingsOverrides = {
  [K in keyof Settings]?: Settings[K] extends object ? Partial<Settings[K]> : Settings[K];
};

/** Each call owns its nested objects and arrays so tests can mutate settings. */
export function createSettings(overrides: SettingsOverrides = {}): Settings {
  const settings = readSettingsFrom(<T>(key: string) =>
    structuredClone(configurationProperties[`freshDeps.${key}`]?.default) as T | undefined);
  for (const key of Object.keys(overrides) as (keyof Settings)[]) {
    const value = overrides[key];
    Object.assign(settings, {
      [key]: typeof value === 'object' ? { ...settings[key] as object, ...structuredClone(value) } : value,
    });
  }
  return settings;
}
