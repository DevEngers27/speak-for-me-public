/**
 * Validating, freezing fixture loader.
 *
 * Every fixture enters the system through `loadFixture` / `safeLoadFixture`, so
 * seed code never builds fixture objects by hand. Issues carry a path, a code
 * and a message, never the offending input value: fixtures contain private
 * briefs, and validation errors end up in logs.
 */
import type { z } from "zod";
import { ScenarioFixtureSchema, type ConstraintSetData, type FixturePhaseData, type ScenarioFixtureData } from "./schema";

/** Recursively readonly view of a value. */
export type DeepReadonly<T> = T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** A loaded fixture: validated, cloned and deeply frozen. */
export type ScenarioFixture = DeepReadonly<ScenarioFixtureData>;
export type ScenarioConstraintSet = DeepReadonly<ConstraintSetData>;
export type ScenarioPhase = DeepReadonly<FixturePhaseData>;

export interface FixtureIssue {
  /** Dotted path into the fixture, e.g. `catalog.items[2].priceCents`. */
  readonly path: string;
  /** Zod issue code, or a loader code (`invalid_json`, `missing_brief_schema`, `scenario_mismatch`). */
  readonly code: string;
  /** Cross-reference check name when the issue came from the consistency pass. */
  readonly check?: string;
  readonly message: string;
}

export interface LoadFixtureOptions {
  /** When set, the fixture's `scenarioId` must equal this value. */
  readonly expectedScenarioId?: string;
  /**
   * Per-role schemas the scenario plugin uses for its opaque brief records.
   * When given, every brief must have a schema (fail closed). Validation only:
   * the stored brief stays the original JSON record.
   */
  readonly briefSchemas?: Readonly<Record<string, z.ZodType>>;
}

export type SafeLoadResult =
  | { readonly ok: true; readonly fixture: ScenarioFixture }
  | { readonly ok: false; readonly issues: readonly FixtureIssue[] };

export class FixtureValidationError extends Error {
  readonly issues: readonly FixtureIssue[];

  constructor(issues: readonly FixtureIssue[]) {
    const head = issues
      .slice(0, 5)
      .map((issue) => `${issue.path || "<root>"}: ${issue.message}`)
      .join("; ");
    const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
    super(`Invalid scenario fixture: ${head}${more}`);
    this.name = "FixtureValidationError";
    this.issues = issues;
  }
}

export function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") out += `[${segment}]`;
    else if (typeof segment === "string" && /^[A-Za-z_$][\w$]*$/.test(segment)) out += out ? `.${segment}` : segment;
    else out += `[${JSON.stringify(String(segment))}]`;
  }
  return out;
}

function toFixtureIssues(error: z.ZodError, prefix: readonly PropertyKey[] = []): FixtureIssue[] {
  return error.issues.map((issue) => {
    const params = issue.code === "custom" ? (issue.params as { check?: unknown } | undefined) : undefined;
    const check = typeof params?.check === "string" ? params.check : undefined;
    const base = { path: formatIssuePath([...prefix, ...issue.path]), code: issue.code, message: issue.message };
    return check === undefined ? base : { ...base, check };
  });
}

/**
 * Recursively freezes a plain-data value in place and returns it. Descends into
 * already-frozen objects too (their children may not be), and tolerates cycles.
 */
export function deepFreeze<T>(value: T): DeepReadonly<T> {
  const seen = new WeakSet<object>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    Object.freeze(node);
    for (const key of Reflect.ownKeys(node)) visit((node as Record<PropertyKey, unknown>)[key]);
  };
  visit(value);
  return value as DeepReadonly<T>;
}

function checkBriefs(fixture: ScenarioFixtureData, options: LoadFixtureOptions): FixtureIssue[] {
  const schemas = options.briefSchemas;
  if (schemas === undefined) return [];
  const issues: FixtureIssue[] = [];
  for (const [roleId, brief] of Object.entries(fixture.privateBriefs)) {
    const schema = Object.hasOwn(schemas, roleId) ? schemas[roleId] : undefined;
    if (schema === undefined) {
      issues.push({
        path: formatIssuePath(["privateBriefs", roleId]),
        code: "missing_brief_schema",
        message: `No brief schema registered for role "${roleId}"`,
      });
      continue;
    }
    const result = schema.safeParse(brief);
    if (!result.success) issues.push(...toFixtureIssues(result.error, ["privateBriefs", roleId]));
  }
  return issues;
}

/** Validates, clones and deep-freezes a fixture. Never throws on bad input. */
export function safeLoadFixture(input: unknown, options: LoadFixtureOptions = {}): SafeLoadResult {
  const parsed = ScenarioFixtureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toFixtureIssues(parsed.error) };

  const issues: FixtureIssue[] = [];
  if (options.expectedScenarioId !== undefined && parsed.data.scenarioId !== options.expectedScenarioId) {
    issues.push({
      path: "scenarioId",
      code: "scenario_mismatch",
      message: `Fixture is for scenario "${parsed.data.scenarioId}", expected "${options.expectedScenarioId}"`,
    });
  }
  issues.push(...checkBriefs(parsed.data, options));
  if (issues.length > 0) return { ok: false, issues };

  // Clone so freezing never touches objects the caller still holds.
  return { ok: true, fixture: deepFreeze(structuredClone(parsed.data)) };
}

/** Like `safeLoadFixture`, but throws `FixtureValidationError` on failure. */
export function loadFixture(input: unknown, options: LoadFixtureOptions = {}): ScenarioFixture {
  const result = safeLoadFixture(input, options);
  if (!result.ok) throw new FixtureValidationError(result.issues);
  return result.fixture;
}

/** Parses fixture JSON text, then loads it. The text is never echoed in issues. */
export function parseFixtureJson(text: string, options: LoadFixtureOptions = {}): SafeLoadResult {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    return { ok: false, issues: [{ path: "", code: "invalid_json", message: "Fixture text is not valid JSON" }] };
  }
  return safeLoadFixture(input, options);
}

/** Returns the constraint set a phase runs under. */
export function constraintSetForPhase(fixture: ScenarioFixture, phaseId: string): ScenarioConstraintSet {
  const phase = fixture.phases.find((p) => p.id === phaseId);
  if (phase === undefined) throw new Error(`Unknown phase id "${phaseId}"`);
  const set = fixture.constraintSets.find((s) => s.version === phase.constraintSetVersion);
  // Unreachable for a loaded fixture: the schema guarantees the version exists.
  if (set === undefined) throw new Error(`Phase "${phaseId}" references a missing constraint set`);
  return set;
}
