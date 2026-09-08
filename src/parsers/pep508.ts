export interface Requirement {
  /** Distribution name as written. */
  name: string;
  /** Version specifier, empty when the requirement states none. */
  spec: string;
  /** Offset of the specifier within the input, so a hint can be anchored to it. */
  specOffset: number;
}

const REQUIREMENT_RE = /^(\s*)([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*/;

/**
 * Parses a PEP 508 requirement - `name[extras] >=1.0,<2 ; marker`. Direct
 * references (`name @ https://…`) name no registry version, so they are dropped.
 */
export function parseRequirement(text: string): Requirement | undefined {
  // Environment markers qualify the requirement, they do not constrain the version.
  const marker = text.indexOf(';');
  const withoutMarker = marker === -1 ? text : text.slice(0, marker);

  const match = REQUIREMENT_RE.exec(withoutMarker);
  if (!match) {
    return undefined;
  }

  let offset = match[0].length;
  let spec = withoutMarker.slice(offset);
  if (spec.includes('@')) {
    return undefined;
  }

  // Some tools wrap the specifier in parentheses, which PEP 508 allows.
  const wrapped = /^(\s*\()(.*)\)\s*$/.exec(spec);
  if (wrapped) {
    offset += wrapped[1].length;
    spec = wrapped[2];
  }

  const leading = spec.length - spec.trimStart().length;
  return { name: match[2], spec: spec.trim(), specOffset: offset + leading };
}
