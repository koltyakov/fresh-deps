import type { DependencyRef } from '../types';
import { normalizePythonSpec } from '../versions';
import { parseRequirement } from './pep508';
import { scanToml, versionOf, type TomlValue } from './toml';

/** Poetry's own key, not a distribution. */
const NOT_A_DEPENDENCY = ['python'];

/**
 * The upper bound Poetry's `^` implies: the leftmost non-zero component is
 * raised and everything after it zeroed, so `^1.2` allows `<2.0` while
 * `^0.2.3` only allows `<0.3.0`.
 */
function caretUpperBound(components: number[]): number[] {
  const bound = components.slice();
  const firstNonZero = bound.findIndex((component) => component !== 0);
  const at = firstNonZero === -1 ? bound.length - 1 : firstNonZero;
  bound[at] += 1;
  for (let i = at + 1; i < bound.length; i++) {
    bound[i] = 0;
  }
  return bound;
}

/** `~` pins the minor when one was given, otherwise the major. */
function tildeUpperBound(components: number[]): number[] {
  const bound = components.slice();
  const at = Math.min(1, bound.length - 1);
  bound[at] += 1;
  for (let i = at + 1; i < bound.length; i++) {
    bound[i] = 0;
  }
  return bound;
}

function translateConstraint(part: string): string | undefined {
  const caret = /^\^\s*(\d+(?:\.\d+)*)$/.exec(part);
  if (caret) {
    return `>=${caret[1]},<${caretUpperBound(caret[1].split('.').map(Number)).join('.')}`;
  }

  const tilde = /^~\s*(\d+(?:\.\d+)*)$/.exec(part);
  if (tilde) {
    return `>=${tilde[1]},<${tildeUpperBound(tilde[1].split('.').map(Number)).join('.')}`;
  }

  if (/^(===|==|!=|~=|<=|>=|<|>)/.test(part)) {
    return part;
  }
  // Poetry reads a bare version as an exact pin.
  if (/^\d/.test(part)) {
    return `==${part}`;
  }
  return undefined;
}

/**
 * Rewrites a Poetry constraint as a PEP 440 specifier set. Poetry borrows `^`
 * and `~` from the npm world, which PEP 440 has no equivalent for, so they are
 * expanded into the bounds they stand for. Alternatives (`||`) have no PEP 440
 * spelling at all and are dropped.
 */
export function poetryToPep440(spec: string): string | undefined {
  const trimmed = spec.trim();
  if (trimmed === '' || trimmed === '*' || trimmed.includes('||')) {
    return undefined;
  }

  const parts: string[] = [];
  for (const raw of trimmed.split(',')) {
    const part = raw.trim();
    if (part === '' || part === '*') {
      continue;
    }
    const translated = translateConstraint(part);
    if (!translated) {
      return undefined;
    }
    parts.push(translated);
  }

  return parts.length ? parts.join(',') : undefined;
}

export interface PyProjectOptions {
  includeBuildRequires: boolean;
}

/**
 * Reads dependencies from a pyproject.toml: PEP 621 `[project]` lists, PEP 735
 * `[dependency-groups]`, the Poetry tables, and - on request - the build
 * requirements.
 */
export function parsePyProject(text: string, options: PyProjectOptions): DependencyRef[] {
  const deps: DependencyRef[] = [];

  const fromRequirements = (value: TomlValue, section: string) => {
    if (value.kind !== 'array') {
      return;
    }
    for (const item of value.items) {
      if (item.kind !== 'string') {
        continue;
      }
      const requirement = parseRequirement(item.text);
      if (!requirement) {
        continue;
      }
      const normalized = normalizePythonSpec(requirement.name, requirement.spec);
      if (normalized) {
        deps.push({ name: normalized.name, spec: normalized.spec, line: item.line, section });
      }
    }
  };

  const fromPoetry = (name: string, value: TomlValue, section: string) => {
    if (NOT_A_DEPENDENCY.includes(name.toLowerCase())) {
      return;
    }
    // A dependency may carry several marker-specific constraints.
    const candidates = value.kind === 'array' ? value.items : [value];
    for (const candidate of candidates) {
      const declared = versionOf(candidate);
      const spec = declared && poetryToPep440(declared.text);
      const normalized = spec ? normalizePythonSpec(name, spec) : undefined;
      if (declared && normalized) {
        deps.push({ name: normalized.name, spec: normalized.spec, line: declared.line, section });
      }
    }
  };

  for (const entry of scanToml(text)) {
    const [a, b, c, d, e, f] = entry.path;

    if (a === 'project' && b === 'dependencies' && entry.path.length === 2) {
      fromRequirements(entry.value, 'project.dependencies');
    } else if (a === 'project' && b === 'optional-dependencies' && entry.path.length === 3) {
      fromRequirements(entry.value, `project.optional-dependencies.${c}`);
    } else if (a === 'dependency-groups' && entry.path.length === 2) {
      fromRequirements(entry.value, `dependency-groups.${b}`);
    } else if (a === 'build-system' && b === 'requires' && entry.path.length === 2) {
      if (options.includeBuildRequires) {
        fromRequirements(entry.value, 'build-system.requires');
      }
    } else if (a === 'tool' && b === 'poetry' && entry.path.length === 4) {
      if (c === 'dependencies' || c === 'dev-dependencies') {
        fromPoetry(d, entry.value, `tool.poetry.${c}`);
      }
    } else if (a === 'tool' && b === 'poetry' && c === 'group' && e === 'dependencies' && entry.path.length === 6) {
      fromPoetry(f, entry.value, `tool.poetry.group.${d}.dependencies`);
    }
  }

  return deps;
}
