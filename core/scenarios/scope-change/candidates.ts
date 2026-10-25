import { addDays, isoDate, type IsoDate, cents, type Cents, normalizeCatalogRow, viewFor, type CatalogRowInput, pickExact, type Projected, type Role, type RoleDisclosures, type View } from '../../engine';
import { scopeChangePlugin } from './plugin';
import { type ScopeChangeRuleInput } from './rules';
export const scopeChangeCandidates = scopeChangePlugin;
export const { roles, fields, checks, protocol, catalog } = scopeChangePlugin;
export { effectiveLeadDaysForRows as effectiveLeadDays } from './rules';
function projectConstructed<T extends object>(value: T): Projected<T> {
  const copy = pickExact as unknown as (source: T, keys: readonly string[]) => Projected<T>;
  return copy(value, Object.keys(value));
}

/**
 * Structural shape of a `scope_change` fixture (`main`, `canaryFixture`, etc.).
 */
export interface ScopeChangeFixtureLike {
  readonly goldenAnchor: string;
  readonly catalog: readonly CatalogRowInput[];
  readonly ledgerBaseline: { readonly amountCents: number };
  readonly briefs: {
    readonly customer: {
      readonly hardFields: {
        readonly requiredItemKeys: readonly string[];
        readonly deadline: { readonly offsetDays: number } | string;
      };
      readonly softFields?: {
        readonly preferredItemKeys?: readonly string[];
        readonly notes?: string;
      };
      readonly disclosures: {
        readonly requiredItemKeys: readonly string[];
        readonly deadline: readonly string[];
        readonly preferredItemKeys?: readonly string[];
      };
    };
    readonly finance: {
      readonly hardFields: { readonly capCents: number };
      readonly disclosures: {
        readonly capCents: readonly string[];
        readonly committedCents: readonly string[];
        readonly headroomCents: readonly string[];
      };
    };
  };
}

export interface FixtureViewOverrides {
  readonly localDate?: IsoDate | string;
  readonly catalog?: readonly CatalogRowInput[];
  readonly capCents?: Cents | number;
  readonly committedCents?: Cents | number;
  readonly requiredItemKeys?: readonly string[];
  readonly deadline?: IsoDate | string;
  readonly disclosures?: Partial<RoleDisclosures> | undefined;
  readonly softFields?: {
    readonly preferredItemKeys?: readonly string[];
    readonly notes?: string;
  };
}

/**
 * Builds the full `View<ScopeChangeRuleInput>` (`viewer: 'system'`) from a `scope_change` fixture
 * and optional overrides.
 */
export function systemViewFromFixture(
  fixture: ScopeChangeFixtureLike,
  overrides?: FixtureViewOverrides,
): Projected<View<ScopeChangeRuleInput>> {
  const anchorDate = isoDate(fixture.goldenAnchor);
  const localDate = overrides?.localDate ? isoDate(overrides.localDate) : anchorDate;
  const rawDeadline = fixture.briefs.customer.hardFields.deadline;
  const defaultDeadline =
    typeof rawDeadline === 'string'
      ? isoDate(rawDeadline)
      : addDays(anchorDate, rawDeadline.offsetDays);

  const normalizedCatalog = (overrides?.catalog ?? fixture.catalog).map((r) =>
    normalizeCatalogRow(r, catalog.ownerRole),
  );
  const capCents = cents(overrides?.capCents ?? fixture.briefs.finance.hardFields.capCents);
  const committedCents = cents(overrides?.committedCents ?? fixture.ledgerBaseline.amountCents);
  const headroomCents = capCents - committedCents;
  const requiredItemKeys = [
    ...(overrides?.requiredItemKeys ?? fixture.briefs.customer.hardFields.requiredItemKeys),
  ];
  const deadline = overrides?.deadline ? isoDate(overrides.deadline) : defaultDeadline;

  return projectConstructed({
    viewer: 'system' as const,
    localDate,
    catalog: normalizedCatalog,
    capCents,
    committedCents,
    headroomCents,
    requiredItemKeys,
    deadline,
  });
}

/**
 * Thin fixture helper returning `viewFor(scopeChangeCandidates, full, disclosures, role)`
 * (or the system view when `role === 'system'`, used only in `'feasibility'` mode).
 */
export function viewForRoleFromFixture(
  fixture: ScopeChangeFixtureLike,
  role: Role | 'system',
  overrides?: FixtureViewOverrides,
): Projected<View<ScopeChangeRuleInput>> {
  const full = systemViewFromFixture(fixture, overrides);
  if (role === 'system') {
    return full;
  }

  const explicitUndefinedDisclosures =
    overrides !== undefined &&
    'disclosures' in overrides &&
    overrides.disclosures === undefined;

  const mergedDisclosures: RoleDisclosures = explicitUndefinedDisclosures
    ? {}
    : {
        requiredItemKeys:
          overrides?.disclosures?.requiredItemKeys ??
          fixture.briefs.customer.disclosures.requiredItemKeys,
        deadline:
          overrides?.disclosures?.deadline ?? fixture.briefs.customer.disclosures.deadline,
        preferredItemKeys:
          overrides?.disclosures?.preferredItemKeys ??
          fixture.briefs.customer.disclosures.preferredItemKeys,
        capCents:
          overrides?.disclosures?.capCents ?? fixture.briefs.finance.disclosures.capCents,
        committedCents:
          overrides?.disclosures?.committedCents ??
          fixture.briefs.finance.disclosures.committedCents,
        headroomCents:
          overrides?.disclosures?.headroomCents ??
          fixture.briefs.finance.disclosures.headroomCents,
      };

  return viewFor(scopeChangeCandidates, full, mergedDisclosures, role);
}
