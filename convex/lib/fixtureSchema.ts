import { ITEM_KEY_RE } from "../../core/engine";
import { SCENARIO_KEY_PATTERN } from "../../core/engine";
import { z } from "zod";
import { cents, MAX_CENTS } from "../../core/engine";
import { isoDate } from "../../core/engine";
/**
 * Primitive value schemas shared by every part of a scenario fixture.
 *
 * These encode representation rules only (identifier syntax, integer minor
 * units, calendar dates). They carry no scenario semantics.
 */

/**
 * Identifier syntax for every id in a fixture (roles, members, items,
 * constraints, steps, expectations) and for open vocabularies such as
 * constraint kinds and reason codes.
 *
 * Lowercase ASCII, starts with a letter, segments joined by a single `-`, `_`
 * or `.`. Scenario plugin ids use their own stricter schema.
 */
export const SLUG_PATTERN = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
export const SLUG_MAX_LENGTH = 64;

export const Slug = z.string().min(1).max(SLUG_MAX_LENGTH).regex(SLUG_PATTERN);

/** A short human-readable name. Must contain at least one non-space character. */
export const Label = z.string().min(1).max(200).regex(/\S/);

/** Longer free text (descriptions, notes). */
export const Text = z.string().min(1).max(4000).regex(/\S/);

/**
 * A monetary amount in integer minor units (cents for USD).
 *
 * `z.int()` already restricts values to `Number.isSafeInteger`, which keeps
 * amounts exact when stored as a Convex `v.number()` (float64). Negative values
 * are rejected: fixtures describe prices, caps and totals, never deltas.
 */
export const CentsSchema = z.int().nonnegative().max(MAX_CENTS).transform(value => cents(value));

/**
 * A calendar date `YYYY-MM-DD` with no time and no offset. Zod 4 validates the
 * real calendar, so `2026-02-30` and `2026-02-29` are rejected while
 * `2028-02-29` is accepted. Same-format dates compare correctly as strings.
 */
export const IsoDateSchema = z.iso.date().transform(isoDate);

/** ISO 4217-style alphabetic currency code, e.g. `USD`. */
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);

/**
 * An opaque JSON object. Used for content the generic fixture layer must not
 * interpret (private briefs, constraint parameters). `z.json()` rejects
 * `undefined`, functions, `NaN` and `Infinity`, so the value always survives a
 * JSON round trip and can be stored in Convex.
 */
export const JsonRecord = z.record(z.string(), z.json());

/** List of distinct slugs. Duplicates are reported by the cross-reference pass. */
export const SlugList = z.array(Slug);

/**
 * Generic scenario fixture schema.
 *
 * A fixture is preset, simulated input for one scenario plugin: who takes part,
 * what each role privately knows, which priced items exist, which constraint
 * set versions apply, and what outcome each step of the script must produce.
 *
 * The schema validates structure and internal consistency only. Meaning (what a
 * constraint `kind` does, what a brief contains, why a candidate is infeasible)
 * belongs to the scenario plugin and the rules engine.
 */

export const FIXTURE_SCHEMA_VERSION = 1;

/** Every fixture is simulated data (core rule 8: never present it as real). */
export const FixtureProvenance = z.enum(["seeded", "stub"]);

export const FixtureRole = z.strictObject({
  id: Slug,
  label: Label,
  description: Text.optional(),
});

export const FixtureMember = z.strictObject({
  userId: Slug,
  role: Slug,
  displayName: Label,
});

export const ItemKey = z.string().regex(ITEM_KEY_RE);
export const CatalogItem = z.strictObject({
  itemKey: ItemKey, kind: z.enum(["item", "modifier"]), title: z.string().refine(v => [...v].length > 0 && [...v].length <= 80 && /^[^<>\r\n]+$/u.test(v)),
  priceCents: CentsSchema, leadDays: z.int().nonnegative(),
  taskTemplates: z.array(z.strictObject({title: z.string().min(1).max(320), assigneeRole: Slug.optional()})),
  revision: z.int().min(1).optional(), status: z.enum(["draft", "confirmed", "retired"]).optional(),
});
export const FixtureBrief = z.strictObject({
  hardFields: JsonRecord, softFields: JsonRecord,
  disclosures: z.record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), z.array(Slug)),
});
export const LedgerEntry = z.strictObject({kind: z.literal("baseline"), amountCents: CentsSchema, provenance: FixtureProvenance});

export const ConstraintVisibility = z.enum(["private", "shared"]);

/**
 * One constraint. `kind` is an open vocabulary owned by the scenario plugin.
 * The typed value slots let the generic layer validate amounts, dates and item
 * references without knowing what the kind means.
 */
export const FixtureConstraint = z.strictObject({
  id: Slug,
  kind: Slug,
  ownerRole: Slug,
  visibility: ConstraintVisibility,
  description: Text.optional(),
  amountCents: CentsSchema.optional(),
  date: IsoDateSchema.optional(),
  itemKeys: z.array(ItemKey).optional(),
  params: JsonRecord.optional(),
});

/** A complete snapshot of all constraints at one version (not a delta). */
export const ConstraintSet = z.strictObject({
  version: z.int().min(1),
  label: Label.optional(),
  constraints: z.array(FixtureConstraint),
});

export const ExpectationCandidate = z.strictObject({
  itemKeys: z.array(ItemKey).min(1),
  deliveryDate: IsoDateSchema.optional(),
});

export const ExpectedOutcome = z.strictObject({
  /** Whether the candidate satisfies every constraint of the step's set. */
  feasible: z.boolean().optional(),
  /** Sum of the catalog prices of the candidate items; checked by the loader. */
  itemsTotalCents: CentsSchema.optional(),
  /** Rules-engine reason codes, once that vocabulary is defined. */
  reasonCodes: z.array(z.string().regex(/^[a-z]+\.[a-z][a-z0-9_]*$/)).optional(),
});

export const StepExpectation = z.strictObject({
  id: Slug,
  description: Text,
  candidate: ExpectationCandidate,
  outcome: ExpectedOutcome,
});

export const FixtureStep = z.strictObject({
  id: Slug,
  label: Label,
  description: Text.optional(),
  constraintSetVersion: z.int().min(1),
  expectations: z.array(StepExpectation).min(1),
});

/** Structure only, without cross-reference checks. */
export const ScenarioFixtureShape = z.strictObject({
  schemaVersion: z.literal(FIXTURE_SCHEMA_VERSION),
  id: Slug,
  /** Id of the scenario plugin this fixture is written for. */
  scenarioKey: z.string().regex(SCENARIO_KEY_PATTERN),
  title: Label,
  description: Text.optional(),
  provenance: FixtureProvenance,
  /** Notional "today" of the fixture, so date checks are deterministic. */
  localDate: IsoDateSchema,
  roles: z.array(FixtureRole).min(1),
  members: z.array(FixtureMember).min(1),
  /** Opaque per-role records, keyed by role id. Server-side only. */
  briefs: z.record(Slug, FixtureBrief),
  canaries: z.record(Slug, Text).optional(),
  ledgerEntries: z.array(LedgerEntry).max(1),
  catalogItems: z.array(CatalogItem),
  constraintSets: z.array(ConstraintSet).min(1),
  steps: z.array(FixtureStep).min(1),
});

type Shape = z.output<typeof ScenarioFixtureShape>;
type Path = (string | number)[];

/** Stable machine-readable reasons attached to cross-reference issues. */
export const FIXTURE_CHECK = {
  identityChanged: "constraint_identity_changed",
  duplicateId: "duplicate_id",
  unknownRole: "unknown_role",
  unknownItem: "unknown_item",
  roleWithoutMember: "role_without_member",
  constraintVersionSequence: "constraint_version_sequence",
  unknownConstraintVersion: "unknown_constraint_version",
  constraintVersionRegression: "constraint_version_regression",
  totalMismatch: "total_mismatch",
} as const;
export type FixtureCheck = (typeof FIXTURE_CHECK)[keyof typeof FIXTURE_CHECK];

function checkFixture(fixture: Shape, ctx: z.RefinementCtx): void {
  const report = (check: FixtureCheck, path: Path, message: string): void => {
    ctx.addIssue({ code: "custom", path, message, params: { check } });
  };

  const checkUnique = (ids: readonly string[], path: Path, what: string, key?: string): void => {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) {
        const at = key === undefined ? [...path, index] : [...path, index, key];
        report(FIXTURE_CHECK.duplicateId, at, `Duplicate ${what} "${id}"`);
      }
      seen.add(id);
    });
  };

  const roles = new Set(fixture.roles.map((r) => r.id));
  const priceById = new Map(fixture.catalogItems.map((i) => [i.itemKey, i.priceCents] as const));

  const checkRole = (role: string, path: Path): void => {
    if (!roles.has(role)) report(FIXTURE_CHECK.unknownRole, path, "Unknown role");
  };
  const checkItems = (itemKeys: readonly string[], path: Path): boolean => {
    let allKnown = true;
    itemKeys.forEach((itemId, index) => {
      if (!priceById.has(itemId)) {
        allKnown = false;
        report(FIXTURE_CHECK.unknownItem, [...path, index], `Unknown catalog item id "${itemId}"`);
      }
    });
    checkUnique(itemKeys, path, "item reference");
    return allKnown && new Set(itemKeys).size === itemKeys.length;
  };

  // Identity.
  checkUnique(fixture.roles.map((r) => r.id), ["roles"], "role id", "id");
  checkUnique(fixture.members.map((p) => p.userId), ["members"], "member user id", "userId");
  checkUnique(fixture.catalogItems.map((i) => i.itemKey), ["catalogItems"], "catalog item key", "itemKey");
  checkUnique(fixture.steps.map((p) => p.id), ["steps"], "phase id", "id");

  // Members and roles.
  checkUnique(fixture.members.map(p => p.role), ["members"], "member role", "role");
  fixture.members.forEach((p, i) => checkRole(p.role, ["members", i, "role"]));
  const filledRoles = new Set(fixture.members.map((p) => p.role));
  fixture.roles.forEach((role, i) => {
    if (!filledRoles.has(role.id)) {
      report(FIXTURE_CHECK.roleWithoutMember, ["roles", i, "id"], `Role "${role.id}" has no member`);
    }
  });
  for (const role of Object.keys(fixture.briefs)) checkRole(role, ["briefs", role]);


  for (const [role, brief] of Object.entries(fixture.briefs)) {
    for (const targets of Object.values(brief.disclosures)) targets.forEach(target => checkRole(target, ["briefs", role]));
  }
  for (const role of Object.keys(fixture.canaries ?? {})) checkRole(role, ["canaries"]);
  const identities = new Map<string, string>();
  // Constraint sets: versions are exactly 1..n in order.
  fixture.constraintSets.forEach((set, s) => {
    if (set.version !== s + 1) {
      report(
        FIXTURE_CHECK.constraintVersionSequence,
        ["constraintSets", s, "version"],
        `Constraint set versions must be 1..n in order; expected ${s + 1}, got ${set.version}`,
      );
    }
    checkUnique(set.constraints.map((c) => c.id), ["constraintSets", s, "constraints"], "constraint id", "id");
    set.constraints.forEach((constraint, c) => {
      const base: Path = ["constraintSets", s, "constraints", c];
      const identity = JSON.stringify([constraint.kind, constraint.ownerRole, constraint.visibility]);
      if (identities.has(constraint.id) && identities.get(constraint.id) !== identity) report("constraint_identity_changed", base, "Constraint identity changed");
      identities.set(constraint.id, identity);
      checkRole(constraint.ownerRole, [...base, "ownerRole"]);
      if (constraint.itemKeys !== undefined) checkItems(constraint.itemKeys, [...base, "itemKeys"]);
    });
  });

  // Script steps: reference an existing version; versions never go backwards.
  const versionCount = fixture.constraintSets.length;
  let previousVersion = 0;
  fixture.steps.forEach((phase, p) => {
    const base: Path = ["steps", p];
    if (phase.constraintSetVersion > versionCount) {
      report(
        FIXTURE_CHECK.unknownConstraintVersion,
        [...base, "constraintSetVersion"],
        `Unknown constraint set version ${phase.constraintSetVersion}`,
      );
    } else if (phase.constraintSetVersion < previousVersion) {
      report(
        FIXTURE_CHECK.constraintVersionRegression,
        [...base, "constraintSetVersion"],
        `Constraint set version goes back from ${previousVersion} to ${phase.constraintSetVersion}`,
      );
    }
    if (phase.constraintSetVersion <= versionCount) previousVersion = Math.max(previousVersion, phase.constraintSetVersion);

    checkUnique(phase.expectations.map((e) => e.id), [...base, "expectations"], "expectation id", "id");
    phase.expectations.forEach((expectation, e) => {
      const at: Path = [...base, "expectations", e];
      const itemKeys = expectation.candidate.itemKeys;
      if (!checkItems(itemKeys, [...at, "candidate", "itemKeys"])) return;
      if (expectation.outcome.itemsTotalCents === undefined) return;
      const total = itemKeys.reduce((sum, id) => sum + (priceById.get(id) ?? 0), 0);
      if (!Number.isSafeInteger(total) || total !== expectation.outcome.itemsTotalCents) {
        report(
          FIXTURE_CHECK.totalMismatch,
          [...at, "outcome", "itemsTotalCents"],
          "Candidate total does not match catalog prices or exceeds the safe integer range",
        );
      }
    });
  });
}

/** Full fixture schema: structure plus cross-reference and arithmetic checks. */
export const ScenarioFixtureSchema = ScenarioFixtureShape.superRefine(checkFixture);

/** What a fixture author writes. */
export type ScenarioFixtureInput = z.input<typeof ScenarioFixtureSchema>;
/** Parsed, not yet frozen. Prefer `ScenarioFixture` from the loader. */
export type ScenarioFixtureData = z.output<typeof ScenarioFixtureSchema>;

export type FixtureRoleData = z.output<typeof FixtureRole>;
export type FixtureMemberData = z.output<typeof FixtureMember>;
export type CatalogItemData = z.output<typeof CatalogItem>;
export type FixtureConstraintData = z.output<typeof FixtureConstraint>;
export type ConstraintSetData = z.output<typeof ConstraintSet>;
export type FixtureStepData = z.output<typeof FixtureStep>;
export type StepExpectationData = z.output<typeof StepExpectation>;
export type ConstraintVisibilityValue = z.output<typeof ConstraintVisibility>;

/**
 * JSON Schema (draft 2020-12) of the fixture structure, for editor completion
 * when fixtures are authored as JSON. Cross-reference checks are not
 * expressible in JSON Schema; always load through the loader.
 */
export function scenarioFixtureJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ScenarioFixtureShape, { io: "input" }) as Record<string, unknown>;
}

/**
 * Validating, freezing fixture loader.
 *
 * Every fixture enters the system through `loadFixture` / `safeLoadFixture`, so
 * seed code never builds fixture objects by hand. Issues carry a path, a code
 * and a message, never the offending input value: fixtures contain private
 * briefs, and validation errors end up in logs.
 */

/** Recursively readonly view of a value. */
export type DeepReadonly<T> = T extends string | number | boolean | null | undefined ? T : T extends (infer U)[]
  ? readonly DeepReadonly<U>[]
  : T extends object
    ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
    : T;

/** A loaded fixture: validated, cloned and deeply frozen. */
declare const loadedFixture: unique symbol;
export type ScenarioFixture = DeepReadonly<ScenarioFixtureData> & { readonly [loadedFixture]: true };
export type ScenarioConstraintSet = DeepReadonly<ConstraintSetData>;
export type ScenarioStep = DeepReadonly<FixtureStepData>;

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
  /** When set, the fixture's `scenarioKey` must equal this value. */
  readonly expectedScenarioKey?: string;
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
    const base = { path: prefix[0] === "briefs" || issue.path[0] === "briefs" ? "briefs" : formatIssuePath([...prefix, ...issue.path].filter(v => typeof v === "number" || ["catalogItems", "ledgerEntries", "steps", "roles", "members", "constraintSets"].includes(String(v)))), code: issue.code, message: "Invalid fixture field" };
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
  for (const [role, brief] of Object.entries(fixture.briefs)) {
    const schema = Object.hasOwn(schemas, role) ? schemas[role] : undefined;
    if (schema === undefined) {
      issues.push({
        path: "briefs",
        code: "missing_brief_schema",
        message: "No brief schema registered",
      });
      continue;
    }
    try {
      const result = schema.safeParse(brief);
      if (!result.success) issues.push(...toFixtureIssues(result.error, ["briefs"]));
    } catch {
      issues.push({path: "briefs", code: "brief_schema_error", message: "Brief schema must validate synchronously"});
    }
  }
  for (const role of Object.keys(schemas)) {
    if (!Object.hasOwn(fixture.briefs, role)) issues.push({path: "briefs", code: "missing_brief", message: "Missing registered brief"});
  }
  return issues;
}

/** Validates, clones and deep-freezes a fixture. Never throws on bad input. */
function loadChecked(input: unknown, options: LoadFixtureOptions = {}): SafeLoadResult {
  const seen = new Set<object>();
  function checkData(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    if (seen.has(value)) throw new TypeError("Cyclic fixture");
    seen.add(value);
    for (const key of Object.keys(value)) {
      if (key === "__proto__" || key.startsWith("$") || !/^[\x20-\x7e]{0,1024}$/.test(key)) throw new TypeError("Invalid fixture key");
      checkData((value as Record<string, unknown>)[key]);
    }
    seen.delete(value);
  }
  checkData(input);
  const parsed = ScenarioFixtureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, issues: toFixtureIssues(parsed.error) };

  const issues: FixtureIssue[] = [];
  if (options.expectedScenarioKey !== undefined && parsed.data.scenarioKey !== options.expectedScenarioKey) {
    issues.push({
      path: "scenarioKey",
      code: "scenario_mismatch",
      message: "Fixture scenario mismatch",
    });
  }
  issues.push(...checkBriefs(parsed.data, options));
  if (issues.length > 0) return { ok: false, issues };

  // Clone so freezing never touches objects the caller still holds.
  return { ok: true, fixture: deepFreeze(structuredClone(parsed.data)) as ScenarioFixture };
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

/** Returns the constraint set a step runs under. */
export function constraintSetForStep(fixture: ScenarioFixture, stepId: string): ScenarioConstraintSet {
  const phase = fixture.steps.find((p) => p.id === stepId);
  if (phase === undefined) throw new Error("Unknown fixture step");
  const set = fixture.constraintSets.find((s) => s.version === phase.constraintSetVersion);
  // Unreachable for a loaded fixture: the schema guarantees the version exists.
  if (set === undefined) throw new Error("Step references missing constraints");
  return set;
}

/** Plugin schemas must be synchronous. Unknown exceptions never expose their text. */
export function safeLoadFixture(input: unknown, options: LoadFixtureOptions = {}): SafeLoadResult {
  try { return loadChecked(input, options); }
  catch { return {ok: false, issues: [{path: "", code: "invalid_fixture", message: "Invalid fixture"}]}; }
}
/** Private leaves for canary scanning only. Never render fixture metadata as room text. */
export function privateValuesOf(fixture: ScenarioFixture): unknown[] {
  const values: unknown[] = [];
  function leaves(value: unknown): void {
    if (value !== null && typeof value === "object") Object.values(value).forEach(leaves);
    else values.push(value);
  }
  Object.values(fixture.briefs).forEach(leaves);
  fixture.constraintSets.forEach(set => set.constraints.filter(c => c.visibility === "private").forEach(leaves));
  if (fixture.canaries) Object.values(fixture.canaries).forEach(leaves);
  return values;
}
