/**
 * Generic scenario fixture schema.
 *
 * A fixture is preset, simulated input for one scenario plugin: who takes part,
 * what each role privately knows, which priced items exist, which constraint
 * set versions apply, and what outcome each phase of the script must produce.
 *
 * The schema validates structure and internal consistency only. Meaning (what a
 * constraint `kind` does, what a brief contains, why a candidate is infeasible)
 * belongs to the scenario plugin and the rules engine.
 */
import { z } from "zod";
import { Cents, CurrencyCode, IsoDate, JsonRecord, Label, Slug, SlugList, Text } from "./primitives";

export const FIXTURE_SCHEMA_VERSION = 1;

/** Every fixture is simulated data (core rule 8: never present it as real). */
export const FixtureProvenance = z.strictObject({
  simulated: z.literal(true),
  /** Shown wherever data derived from this fixture is displayed. */
  label: Label,
  notes: Text.optional(),
});

export const FixtureRole = z.strictObject({
  id: Slug,
  label: Label,
  description: Text.optional(),
});

export const FixtureParticipant = z.strictObject({
  id: Slug,
  roleId: Slug,
  displayName: Label,
});

export const CatalogItem = z.strictObject({
  id: Slug,
  label: Label,
  description: Text.optional(),
  priceCents: Cents,
  /** Earliest calendar date on which this item can be delivered. */
  earliestDate: IsoDate,
  /** Role whose confirmed information is the source of the price and date. */
  sourceRoleId: Slug,
});

export const Catalog = z.strictObject({
  /** Currency of every `*Cents` amount in the fixture. */
  currency: CurrencyCode,
  items: z.array(CatalogItem).min(1),
});

export const ConstraintVisibility = z.enum(["private", "shared"]);

/**
 * One constraint. `kind` is an open vocabulary owned by the scenario plugin.
 * The typed value slots let the generic layer validate amounts, dates and item
 * references without knowing what the kind means.
 */
export const FixtureConstraint = z.strictObject({
  id: Slug,
  kind: Slug,
  ownerRoleId: Slug,
  visibility: ConstraintVisibility,
  description: Text.optional(),
  amountCents: Cents.optional(),
  date: IsoDate.optional(),
  itemIds: SlugList.optional(),
  params: JsonRecord.optional(),
});

/** A complete snapshot of all constraints at one version (not a delta). */
export const ConstraintSet = z.strictObject({
  version: z.int().min(1),
  label: Label.optional(),
  constraints: z.array(FixtureConstraint),
});

export const ExpectationCandidate = z.strictObject({
  itemIds: SlugList.min(1),
  deliveryDate: IsoDate.optional(),
});

export const ExpectedOutcome = z.strictObject({
  /** Whether the candidate satisfies every constraint of the phase's set. */
  feasible: z.boolean(),
  /** Sum of the catalog prices of the candidate items; checked by the loader. */
  itemsTotalCents: Cents,
  /** Rules-engine reason codes, once that vocabulary is defined. */
  reasonCodes: SlugList.optional(),
});

export const PhaseExpectation = z.strictObject({
  id: Slug,
  description: Text,
  candidate: ExpectationCandidate,
  outcome: ExpectedOutcome,
});

export const FixturePhase = z.strictObject({
  id: Slug,
  label: Label,
  description: Text.optional(),
  constraintSetVersion: z.int().min(1),
  expectations: z.array(PhaseExpectation).min(1),
});

/** Structure only, without cross-reference checks. */
export const ScenarioFixtureShape = z.strictObject({
  schemaVersion: z.literal(FIXTURE_SCHEMA_VERSION),
  id: Slug,
  /** Id of the scenario plugin this fixture is written for. */
  scenarioId: Slug,
  title: Label,
  description: Text.optional(),
  provenance: FixtureProvenance,
  /** Notional "today" of the fixture, so date checks are deterministic. */
  asOf: IsoDate,
  roles: z.array(FixtureRole).min(1),
  participants: z.array(FixtureParticipant).min(1),
  /** Opaque per-role records, keyed by role id. Server-side only. */
  privateBriefs: z.record(Slug, JsonRecord),
  catalog: Catalog,
  constraintSets: z.array(ConstraintSet).min(1),
  phases: z.array(FixturePhase).min(1),
});

type Shape = z.output<typeof ScenarioFixtureShape>;
type Path = (string | number)[];

/** Stable machine-readable reasons attached to cross-reference issues. */
export const FIXTURE_CHECK = {
  duplicateId: "duplicate_id",
  unknownRole: "unknown_role",
  unknownItem: "unknown_item",
  roleWithoutParticipant: "role_without_participant",
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

  const roleIds = new Set(fixture.roles.map((r) => r.id));
  const priceById = new Map(fixture.catalog.items.map((i) => [i.id, i.priceCents] as const));

  const checkRole = (roleId: string, path: Path): void => {
    if (!roleIds.has(roleId)) report(FIXTURE_CHECK.unknownRole, path, `Unknown role id "${roleId}"`);
  };
  const checkItems = (itemIds: readonly string[], path: Path): boolean => {
    let allKnown = true;
    itemIds.forEach((itemId, index) => {
      if (!priceById.has(itemId)) {
        allKnown = false;
        report(FIXTURE_CHECK.unknownItem, [...path, index], `Unknown catalog item id "${itemId}"`);
      }
    });
    checkUnique(itemIds, path, "item reference");
    return allKnown;
  };

  // Identity.
  checkUnique(fixture.roles.map((r) => r.id), ["roles"], "role id", "id");
  checkUnique(fixture.participants.map((p) => p.id), ["participants"], "participant id", "id");
  checkUnique(fixture.catalog.items.map((i) => i.id), ["catalog", "items"], "catalog item id", "id");
  checkUnique(fixture.phases.map((p) => p.id), ["phases"], "phase id", "id");

  // Participants and roles.
  fixture.participants.forEach((p, i) => checkRole(p.roleId, ["participants", i, "roleId"]));
  const filledRoles = new Set(fixture.participants.map((p) => p.roleId));
  fixture.roles.forEach((role, i) => {
    if (!filledRoles.has(role.id)) {
      report(FIXTURE_CHECK.roleWithoutParticipant, ["roles", i, "id"], `Role "${role.id}" has no participant`);
    }
  });
  for (const roleId of Object.keys(fixture.privateBriefs)) checkRole(roleId, ["privateBriefs", roleId]);

  // Catalog provenance.
  fixture.catalog.items.forEach((item, i) => checkRole(item.sourceRoleId, ["catalog", "items", i, "sourceRoleId"]));

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
      checkRole(constraint.ownerRoleId, [...base, "ownerRoleId"]);
      if (constraint.itemIds !== undefined) checkItems(constraint.itemIds, [...base, "itemIds"]);
    });
  });

  // Phases: reference an existing version; versions never go backwards.
  const versionCount = fixture.constraintSets.length;
  let previousVersion = 0;
  fixture.phases.forEach((phase, p) => {
    const base: Path = ["phases", p];
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
    previousVersion = Math.max(previousVersion, phase.constraintSetVersion);

    checkUnique(phase.expectations.map((e) => e.id), [...base, "expectations"], "expectation id", "id");
    phase.expectations.forEach((expectation, e) => {
      const at: Path = [...base, "expectations", e];
      const itemIds = expectation.candidate.itemIds;
      if (!checkItems(itemIds, [...at, "candidate", "itemIds"])) return;
      const total = itemIds.reduce((sum, id) => sum + (priceById.get(id) ?? 0), 0);
      if (!Number.isSafeInteger(total) || total !== expectation.outcome.itemsTotalCents) {
        report(
          FIXTURE_CHECK.totalMismatch,
          [...at, "outcome", "itemsTotalCents"],
          `itemsTotalCents is ${expectation.outcome.itemsTotalCents} but catalog prices sum to ${total}`,
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
export type FixtureParticipantData = z.output<typeof FixtureParticipant>;
export type CatalogItemData = z.output<typeof CatalogItem>;
export type FixtureConstraintData = z.output<typeof FixtureConstraint>;
export type ConstraintSetData = z.output<typeof ConstraintSet>;
export type FixturePhaseData = z.output<typeof FixturePhase>;
export type PhaseExpectationData = z.output<typeof PhaseExpectation>;
export type ConstraintVisibilityValue = z.output<typeof ConstraintVisibility>;

/**
 * JSON Schema (draft 2020-12) of the fixture structure, for editor completion
 * when fixtures are authored as JSON. Cross-reference checks are not
 * expressible in JSON Schema; always load through the loader.
 */
export function scenarioFixtureJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(ScenarioFixtureShape, { io: "input" }) as Record<string, unknown>;
}
