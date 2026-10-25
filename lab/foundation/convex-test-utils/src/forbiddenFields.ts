/**
 * Forbidden-field detection for query/mutation return values.
 *
 * Pattern language (kept deliberately small):
 * - `"secret"`            bare key: matches a key named `secret` at ANY depth.
 * - `"a.b.c"`             dotted path anchored at the root of the payload.
 * - `"a.*.c"`             `*` matches exactly one segment (object key or array index).
 * - `"a.**.c"`            `**` matches zero or more segments.
 * - `/^private/i`         RegExp: tested against every key name at any depth.
 *
 * Array elements contribute their index as a path segment, so
 * `"items.*.secret"` matches `{ items: [{ secret: 1 }] }`.
 *
 * Key PRESENCE is what counts: `{ secret: undefined }` is a violation by
 * default, because the goal is "the field is never even considered for the
 * response", not "the field happened to be empty this time".
 */

export type ForbiddenPattern = string | RegExp;

export interface ForbiddenFieldViolation {
  /** Human-readable path, e.g. `$.notes[0].privateMemo`. */
  path: string;
  /** The offending key. */
  key: string;
  /** The pattern that matched, as written. */
  pattern: string;
}

export interface FindOptions {
  /** Treat keys whose value is `undefined` as absent. Default false. */
  ignoreUndefinedValues?: boolean;
  /** Fail closed beyond this nesting depth. Default 64. */
  maxDepth?: number;
}

type Segment = string | number;

interface CompiledPattern {
  source: string;
  test: (path: readonly Segment[], key: string) => boolean;
}

function compile(pattern: ForbiddenPattern): CompiledPattern {
  if (pattern instanceof RegExp) {
    // Strip stateful flags so `.test` is pure across calls.
    const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
    return { source: String(pattern), test: (_path, key) => re.test(key) };
  }
  if (pattern.length === 0) throw new Error("forbidden pattern must be non-empty");
  const parts = pattern.split(".");
  if (parts.some((p) => p.length === 0)) throw new Error(`invalid forbidden pattern "${pattern}"`);
  if (parts.length === 1 && parts[0] !== "*" && parts[0] !== "**") {
    return { source: pattern, test: (_path, key) => key === pattern };
  }
  return { source: pattern, test: (path) => matchSegments(parts, 0, path, 0) };
}

function matchSegments(parts: readonly string[], pi: number, path: readonly Segment[], si: number): boolean {
  if (pi === parts.length) return si === path.length;
  const part = parts[pi];
  if (part === "**") {
    for (let k = si; k <= path.length; k++) {
      if (matchSegments(parts, pi + 1, path, k)) return true;
    }
    return false;
  }
  if (si === path.length) return false;
  if (part !== "*" && part !== String(path[si])) return false;
  return matchSegments(parts, pi + 1, path, si + 1);
}

function formatPath(path: readonly Segment[]): string {
  let out = "$";
  for (const seg of path) {
    if (typeof seg === "number") out += `[${seg}]`;
    else if (/^[A-Za-z_$][\w$]*$/.test(seg)) out += `.${seg}`;
    else out += `[${JSON.stringify(seg)}]`;
  }
  return out;
}

function isWalkable(value: unknown): value is object {
  if (typeof value !== "object" || value === null) return false;
  // Convex `v.bytes()` values arrive as ArrayBuffer; they have no keys to leak.
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return false;
  return true;
}

/** Return every forbidden key found in `payload` (empty array = clean). */
export function findForbiddenFields(
  payload: unknown,
  forbidden: readonly ForbiddenPattern[],
  options: FindOptions = {},
): ForbiddenFieldViolation[] {
  if (forbidden.length === 0) throw new Error("findForbiddenFields: forbidden list is empty");
  const compiled = forbidden.map(compile);
  const maxDepth = options.maxDepth ?? 64;
  const violations: ForbiddenFieldViolation[] = [];
  const ancestors = new Set<object>();

  const visit = (value: unknown, path: Segment[]): void => {
    if (!isWalkable(value)) return;
    if (path.length > maxDepth) {
      throw new Error(`findForbiddenFields: nesting deeper than maxDepth=${maxDepth} at ${formatPath(path)}`);
    }
    if (ancestors.has(value)) return; // cycle: already being walked higher up
    ancestors.add(value);
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...path, index]));
    } else {
      for (const [key, child] of Object.entries(value)) {
        const childPath = [...path, key];
        if (!(options.ignoreUndefinedValues === true && child === undefined)) {
          for (const p of compiled) {
            if (p.test(childPath, key)) {
              violations.push({ path: formatPath(childPath), key, pattern: p.source });
            }
          }
        }
        visit(child, childPath);
      }
    }
    ancestors.delete(value);
  };

  visit(payload, []);
  return violations;
}

export class ForbiddenFieldsError extends Error {
  readonly violations: readonly ForbiddenFieldViolation[];
  constructor(violations: readonly ForbiddenFieldViolation[], label?: string) {
    const lines = violations.map((v) => `  ${v.path} (matched ${v.pattern})`).join("\n");
    super(`${label ?? "payload"} contains ${violations.length} forbidden field(s):\n${lines}`);
    this.name = "ForbiddenFieldsError";
    this.violations = violations;
  }
}

/** Throw {@link ForbiddenFieldsError} if `payload` contains any forbidden key. */
export function assertNoForbiddenFields(
  payload: unknown,
  forbidden: readonly ForbiddenPattern[],
  options: FindOptions & { label?: string } = {},
): void {
  const violations = findForbiddenFields(payload, forbidden, options);
  if (violations.length > 0) throw new ForbiddenFieldsError(violations, options.label);
}

/**
 * Anti-vacuity guard: throw unless EVERY pattern matches something in
 * `positiveControl` (typically the raw document read via `t.run`). Catches
 * typos such as forbidding `"privateMemmo"`, which would make
 * `assertNoForbiddenFields` pass forever.
 */
export function assertPatternsMatch(positiveControl: unknown, forbidden: readonly ForbiddenPattern[]): void {
  const unmatched = forbidden.filter((p) => findForbiddenFields(positiveControl, [p]).length === 0);
  if (unmatched.length > 0) {
    throw new Error(`assertPatternsMatch: pattern(s) matched nothing in the positive control: ${unmatched.map(String).join(", ")}`);
  }
}

export interface CanaryHit {
  path: string;
  canary: string;
  where: "key" | "value";
}

/**
 * Find canary substrings anywhere in keys or string values. Complements field
 * checks: a private value copied into an allowed field (e.g. pasted into a
 * public summary) has an innocent key but still leaks.
 */
export function findCanaries(payload: unknown, canaries: readonly string[], options: { maxDepth?: number } = {}): CanaryHit[] {
  if (canaries.some((c) => c.length === 0)) throw new Error("findCanaries: canaries must be non-empty");
  const maxDepth = options.maxDepth ?? 64;
  const hits: CanaryHit[] = [];
  const ancestors = new Set<object>();
  const check = (text: string, path: Segment[], where: CanaryHit["where"]) => {
    for (const canary of canaries) if (text.includes(canary)) hits.push({ path: formatPath(path), canary, where });
  };
  const visit = (value: unknown, path: Segment[]): void => {
    if (typeof value === "string") return check(value, path, "value");
    if (!isWalkable(value)) return;
    if (path.length > maxDepth) throw new Error(`findCanaries: nesting deeper than maxDepth=${maxDepth}`);
    if (ancestors.has(value)) return;
    ancestors.add(value);
    if (Array.isArray(value)) value.forEach((item, i) => visit(item, [...path, i]));
    else
      for (const [key, child] of Object.entries(value)) {
        check(key, [...path, key], "key");
        visit(child, [...path, key]);
      }
    ancestors.delete(value);
  };
  visit(payload, []);
  return hits;
}

/** Throw unless no canary appears anywhere in `payload`. */
export function assertNoCanaries(payload: unknown, canaries: readonly string[], label = "payload"): void {
  const hits = findCanaries(payload, canaries);
  if (hits.length > 0) {
    // Report paths, never the canary context, so failures do not echo private text.
    const lines = hits.map((h) => `  ${h.path} (${h.where} contains canary #${canaries.indexOf(h.canary)})`).join("\n");
    throw new Error(`${label} contains ${hits.length} canary hit(s):\n${lines}`);
  }
}
