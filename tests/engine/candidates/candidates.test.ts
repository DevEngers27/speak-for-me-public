import type { ActionCtx } from '../../../core/engine';
import { describe, expect, it } from 'vitest';
function actionCtx(snapshotSize: number): ActionCtx {
  return { snapshotSize, clarifyUsedInRun: false, escalateUsedInRun: false, proposeCountInRun: 0, counterCountInRun: 0, providerRejectLocked: false, topicKeys: [] };
}

import {
  addDays,
  allowedActions,
  cents,
  checkProposal,
  enumerateCandidates,
  isoDate,
  isOptionKey,
  isProjected,
  isRoleView,
  materializeSelectedOption,
  normalizeCatalogRow,
  pickExact,
  PluginContractError,
  resolveOptionKey,
  resolveOptionKeyWithReason,
  viewFor,
} from '../../../core/engine';
import {
  candidateSpace,
  catalog,
  checks,
  materialize,
  protocol,
  scopeChangeCandidates,
  scopeChangePlugin,
  stubDecide,
  systemViewFromFixture,
  viewForRoleFromFixture,
} from '../../../core/scenarios/scope-change';
import { CANARY_RATIONALE } from '../../../core/scenarios/scope-change/fixtures/canaries';
import { main, proposalExpectations } from '../../../core/scenarios/scope-change/fixtures/main';
import { canaryFixture } from '../../../core/scenarios/scope-change/fixtures/variants';
import { plugin as testScenarioPlugin } from '../rules/fixture';

it('candidate slice is the registered plugin for every shared member', () => {
  expect(scopeChangeCandidates).toBe(scopeChangePlugin);
  for (const key of Object.keys(scopeChangeCandidates) as (keyof typeof scopeChangeCandidates)[]) expect(scopeChangeCandidates[key]).toBe(scopeChangePlugin[key]);
});

describe('W1-2 · Candidate enumeration, snapshot, materialization, and stubDecide', () => {
  describe('1. Unified viewFor contract (i01, i02, i06, i09) and enumeration on main fixture', () => {
    it('enforces one viewFor contract: viewFor(plugin, full, disclosures, role) matches viewForRoleFromFixture and enumerates the 2-item golden (T06-U18) for provider', () => {
      const fullSystem = systemViewFromFixture(main);
      const providerView = viewFor(
        scopeChangeCandidates,
        fullSystem,
        main.briefs.customer.disclosures,
        'provider',
      );
      const helperProviderView = viewForRoleFromFixture(main, 'provider');
      expect(providerView).toEqual(helperProviderView);
      expect(providerView.viewer).toBe('provider');
      expect(providerView.localDate).toBe('2026-11-02');
      expect(providerView.requiredItemKeys).toEqual(['audit_log_export', 'sso_login']);
      expect(providerView.deadline).toBe('2026-11-20');
      expect(providerView.capCents).toBeUndefined();
      expect(providerView.committedCents).toBeUndefined();
      expect(providerView.headroomCents).toBeUndefined();

      // T06-U18: enumerateCandidates(plugin, viewFor(...), { roundNo: 1, turnKind: 'propose' }) gives the 2-item golden
      const snapshot = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(Array.isArray(snapshot)).toBe(false);
      expect(snapshot.items).toEqual([
        {
          optionKey: 'O1',
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: [],
          amountCents: 80_000,
          deliveryDate: '2026-11-16',
        },
        {
          optionKey: 'O2',
          candidateKey: 'audit_log_export+sso_login+usage_dashboard',
          itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
          modifiers: [],
          amountCents: 90_000,
          deliveryDate: '2026-11-18',
        },
      ]);
      expect(snapshot.emptyReasons).toEqual([]);
      expect(snapshot.materialized).toHaveLength(2);

      const mergedDisclosures = {
        ...main.briefs.customer.disclosures,
        ...main.briefs.finance.disclosures,
      };
      const customerView = viewFor(
        scopeChangeCandidates,
        fullSystem,
        mergedDisclosures,
        'customer',
      );
      expect(customerView).toEqual(viewForRoleFromFixture(main, 'customer'));
      expect(customerView.viewer).toBe('customer');
      expect(customerView.requiredItemKeys).toEqual(['audit_log_export', 'sso_login']);
      expect(customerView.deadline).toBe('2026-11-20');
      expect(customerView.capCents).toBe(500_000);
      expect(customerView.committedCents).toBeUndefined();
      expect(customerView.headroomCents).toBeUndefined();

      // When finance discloses committedCents to customer alongside capCents, viewFor derives headroomCents (D12④)
      const customerWithCommitted = viewFor(
        scopeChangeCandidates,
        fullSystem,
        {
          ...mergedDisclosures,
          committedCents: ['customer'],
        },
        'customer',
      );
      expect(customerWithCommitted.capCents).toBe(500_000);
      expect(customerWithCommitted.committedCents).toBe(400_000);
      expect(customerWithCommitted.headroomCents).toBe(100_000);

      const financeView = viewFor(
        scopeChangeCandidates,
        fullSystem,
        main.briefs.customer.disclosures,
        'finance',
      );
      expect(financeView).toEqual(viewForRoleFromFixture(main, 'finance'));
      expect(financeView.viewer).toBe('finance');
      expect(financeView.requiredItemKeys).toEqual(['audit_log_export', 'sso_login']);
      expect(financeView.deadline).toBe('2026-11-20');
      expect(financeView.capCents).toBe(500_000);
      expect(financeView.committedCents).toBe(400_000);
      expect(financeView.headroomCents).toBe(100_000);
    });

    it('fails closed when disclosures are empty or omitted on viewFor and rejects unprojected, spread-copied, or pickExact-forged views in enumerateCandidates (r02, i01, i11)', () => {
      const fullSystem = systemViewFromFixture(main, {
        capCents: cents(470_000),
      });
      const allDisclosuresOff = {
        requiredItemKeys: [],
        deadline: [],
        preferredItemKeys: [],
        capCents: [],
        committedCents: [],
        headroomCents: [],
      };

      for (const role of ['provider', 'customer', 'finance'] as const) {
        const withEmpty = viewFor(scopeChangeCandidates, fullSystem, {}, role);
        const withOmitted = viewFor(scopeChangeCandidates, fullSystem, undefined, role);
        const withAllOff = viewFor(scopeChangeCandidates, fullSystem, allDisclosuresOff, role);
        expect(isRoleView(withEmpty)).toBe(true);
        expect(isRoleView(withOmitted)).toBe(true);
        expect(isRoleView(withAllOff)).toBe(true);
        expect(withEmpty).toEqual(withAllOff);
        expect(withOmitted).toEqual(withAllOff);

        const turnKind = role === 'provider' ? 'propose' : 'evaluate';
        const snapEmpty = enumerateCandidates(scopeChangeCandidates, withEmpty, {
          roundNo: 1,
          turnKind,
        });
        const snapOmitted = enumerateCandidates(scopeChangeCandidates, withOmitted, {
          roundNo: 1,
          turnKind,
        });
        const snapAllOff = enumerateCandidates(scopeChangeCandidates, withAllOff, {
          roundNo: 1,
          turnKind,
        });
        expect(snapEmpty).toEqual(snapAllOff);
        expect(snapOmitted).toEqual(snapAllOff);

        // i11: Raw unprojected views are rejected with PluginContractError('unprojected_view')
        expect(() =>
          enumerateCandidates(
            scopeChangeCandidates,
            { ...fullSystem, viewer: role },
            { roundNo: 1, turnKind },
          ),
        ).toThrow(new PluginContractError('unprojected_view'));
      }

      // i11 Failure direction 1: A spread copy {...viewFor(...)} loses the module-private role-view brand
      // and is rejected with unprojected_view instead of being silently re-projected with empty disclosures
      const goldenProviderView = viewForRoleFromFixture(main, 'provider');
      expect(isRoleView(goldenProviderView)).toBe(true);
      const spreadCopy = { ...goldenProviderView };
      expect(isRoleView(spreadCopy)).toBe(false);
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, spreadCopy, {
          roundNo: 1,
          turnKind: 'propose',
        }),
      ).toThrow(new PluginContractError('unprojected_view'));

      // i11 Failure direction 2: An object branded via the public pickExact helper (carrying undisclosed values)
      // has isProjected(forged) === true, but isRoleView(forged) === false, and is rejected with unprojected_view
      const forgedViaPickExact = pickExact(
        {
          viewer: 'provider' as const,
          localDate: fullSystem.localDate,
          catalog: main.catalog.map((r) => normalizeCatalogRow(r, 'provider')),
          capCents: undefined,
          committedCents: undefined,
          headroomCents: undefined,
          requiredItemKeys: ['audit_log_export'] as const,
          deadline: isoDate('2026-11-12'),
        },
        [
          'viewer',
          'localDate',
          'catalog',
          'capCents',
          'committedCents',
          'headroomCents',
          'requiredItemKeys',
          'deadline',
        ],
      );
      expect(isProjected(forgedViaPickExact)).toBe(true);
      expect(isRoleView(forgedViaPickExact)).toBe(false);
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, forgedViaPickExact, {
          roundNo: 1,
          turnKind: 'propose',
        }),
      ).toThrow(new PluginContractError('unprojected_view'));

      // i11: The `role` alias of `viewer` is removed in validateViewForEnumeration
      expect(() =>
        enumerateCandidates(
          scopeChangeCandidates,
          {
            role: 'provider',
            localDate: fullSystem.localDate,
            catalog: fullSystem.catalog,
          } as unknown as typeof goldenProviderView,
          { roundNo: 1, turnKind: 'propose' },
        ),
      ).toThrow(new PluginContractError('unknown_viewer'));

      // Provider without disclosures cannot depend on undisclosed deadline, requiredItemKeys, or budget
      const providerViewA = viewFor(
        scopeChangeCandidates,
        {
          ...fullSystem,
          requiredItemKeys: ['audit_log_export'],
          deadline: isoDate('2026-11-12'),
          capCents: cents(410_000),
          committedCents: cents(400_000),
        },
        {},
        'provider',
      );
      const providerViewB = viewFor(
        scopeChangeCandidates,
        {
          ...fullSystem,
          requiredItemKeys: ['custom_theme', 'slack_alerts'],
          deadline: isoDate('2026-12-30'),
          capCents: cents(900_000),
          committedCents: cents(100_000),
        },
        {},
        'provider',
      );
      expect(providerViewA.requiredItemKeys).toBeUndefined();
      expect(providerViewA.deadline).toBeUndefined();
      expect(providerViewA.capCents).toBeUndefined();
      expect(providerViewA).toEqual(providerViewB);
      expect(
        enumerateCandidates(scopeChangeCandidates, providerViewA, {
          roundNo: 1,
          turnKind: 'propose',
        }),
      ).toEqual(
        enumerateCandidates(scopeChangeCandidates, providerViewB, {
          roundNo: 1,
          turnKind: 'propose',
        }),
      );

      // Customer without disclosures cannot depend on finance budget numbers
      const customerLowCap = viewFor(
        scopeChangeCandidates,
        {
          ...fullSystem,
          capCents: cents(410_000),
          committedCents: cents(400_000),
          headroomCents: 10_000,
        },
        {},
        'customer',
      );
      const customerHighCap = viewFor(
        scopeChangeCandidates,
        {
          ...fullSystem,
          capCents: cents(900_000),
          committedCents: cents(100_000),
          headroomCents: 800_000,
        },
        {},
        'customer',
      );
      expect(customerLowCap.capCents).toBeUndefined();
      expect(customerLowCap.committedCents).toBeUndefined();
      expect(customerLowCap.headroomCents).toBeUndefined();
      expect(customerLowCap).toEqual(customerHighCap);
      expect(
        enumerateCandidates(scopeChangeCandidates, customerLowCap, {
          roundNo: 1,
          turnKind: 'evaluate',
        }).items,
      ).toEqual(
        enumerateCandidates(scopeChangeCandidates, customerHighCap, {
          roundNo: 1,
          turnKind: 'evaluate',
        }).items,
      );
    });

    it('strips budget fields from seller/provider view even if disclosures list provider', () => {
      const fullSystem = systemViewFromFixture(main, {
        capCents: cents(470_000),
      });
      const providerView = viewFor(
        scopeChangeCandidates,
        fullSystem,
        {
          ...main.briefs.customer.disclosures,
          capCents: ['provider', 'customer'],
          committedCents: ['provider', 'customer'],
          headroomCents: ['provider', 'customer'],
        },
        'provider',
      );
      expect(providerView.capCents).toBeUndefined();
      expect(providerView.committedCents).toBeUndefined();
      expect(providerView.headroomCents).toBeUndefined();

      const snap = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      // Provider is never budget-filtered; still sees both $800 and $900 options
      expect(snap.items).toHaveLength(2);
      expect(snap.items.map((s) => s.candidateKey)).toEqual([
        'audit_log_export+sso_login',
        'audit_log_export+sso_login+usage_dashboard',
      ]);
    });

    it('places the cheapest candidate at O1 only when viewer is proposer && turnKind === propose && roundNo === 1 (i03)', () => {
      const providerView = viewForRoleFromFixture(main, 'provider', {
        requiredItemKeys: ['sso_login'],
      });

      const round1 = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(
        round1.items.map((c) => ({
          optionKey: c.optionKey,
          candidateKey: c.candidateKey,
          amountCents: c.amountCents,
        })),
      ).toEqual([
        { optionKey: 'O1', candidateKey: 'sso_login', amountCents: 50_000 },
        { optionKey: 'O2', candidateKey: 'audit_log_export+sso_login', amountCents: 80_000 },
        {
          optionKey: 'O3',
          candidateKey: 'audit_log_export+sso_login+usage_dashboard',
          amountCents: 90_000,
        },
        { optionKey: 'O4', candidateKey: 'sso_login+usage_dashboard', amountCents: 60_000 },
      ]);

      const round2 = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 2,
        turnKind: 'propose',
      });
      expect(
        round2.items.map((c) => ({
          optionKey: c.optionKey,
          candidateKey: c.candidateKey,
          amountCents: c.amountCents,
        })),
      ).toEqual([
        { optionKey: 'O1', candidateKey: 'audit_log_export+sso_login', amountCents: 80_000 },
        {
          optionKey: 'O2',
          candidateKey: 'audit_log_export+sso_login+usage_dashboard',
          amountCents: 90_000,
        },
        { optionKey: 'O3', candidateKey: 'sso_login', amountCents: 50_000 },
        { optionKey: 'O4', candidateKey: 'sso_login+usage_dashboard', amountCents: 60_000 },
      ]);

      // Legacy option shapes must reach the same anchor guard without turn metadata.
      for (const mode of [undefined, 'snapshot'] as const) {
        expect(() => enumerateCandidates(scopeChangeCandidates, providerView, {
          mode, anchor: true, limit: 12, exclude: [], mustInclude: [],
        } as unknown as Parameters<typeof enumerateCandidates>[2])).toThrow('anchor_override_forbidden');
      }
      // Missing turnKind or roundNo in snapshot mode throws; anchor override throws (i03)
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, providerView, {
          roundNo: 1,
        } as unknown as Parameters<typeof enumerateCandidates>[2]),
      ).toThrow(PluginContractError);
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, providerView, {
          turnKind: 'propose',
        } as unknown as Parameters<typeof enumerateCandidates>[2]),
      ).toThrow(PluginContractError);
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, providerView, {
          roundNo: 2,
          turnKind: 'propose',
          anchor: true,
        } as unknown as Parameters<typeof enumerateCandidates>[2]),
      ).toThrow(PluginContractError);
    });

    it('enumerates customer view on main fixture and excludes the base proposal in evaluate turns', () => {
      const customerView = viewForRoleFromFixture(main, 'customer');

      // Full customer view without base proposal exclusion has both $800 and $900
      const allCustomer = enumerateCandidates(scopeChangeCandidates, customerView, {
        roundNo: 1,
        turnKind: 'evaluate',
      });
      expect(allCustomer.items.map((c) => c.candidateKey)).toEqual([
        'audit_log_export+sso_login',
        'audit_log_export+sso_login+usage_dashboard',
      ]);

      // In S4 evaluate turn, base proposal is v1 ($900: audit_log_export+sso_login+usage_dashboard)
      const evalCustomer = enumerateCandidates(scopeChangeCandidates, customerView, {
        roundNo: 1,
        turnKind: 'evaluate',
        baseCandidateKey: 'audit_log_export+sso_login+usage_dashboard',
      });
      expect(evalCustomer.items).toEqual([
        {
          optionKey: 'O1',
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: [],
          amountCents: 80_000,
          deliveryDate: '2026-11-16',
        },
      ]);
    });

    it('enumerates finance view on main fixture: empty in evaluate turn, budget-filtered in feasibility/propose enumeration', () => {
      const financeView = viewForRoleFromFixture(main, 'finance');

      // Finance cannot counter in an evaluate turn -> turn snapshot is empty
      const turnSnap = enumerateCandidates(scopeChangeCandidates, financeView, {
        roundNo: 1,
        turnKind: 'evaluate',
      });
      expect(turnSnap.items).toEqual([]);

      // Direct view enumeration for finance under $5,000 cap ($1,000 headroom): both $800 and $900 fit
      const feasibleAt5000 = enumerateCandidates(scopeChangeCandidates, financeView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(feasibleAt5000.items.map((c) => c.candidateKey)).toEqual([
        'audit_log_export+sso_login',
        'audit_log_export+sso_login+usage_dashboard',
      ]);

      // Under $4,800 cap ($800 headroom): only $800 fits in finance view
      const financeView4800 = viewForRoleFromFixture(main, 'finance', { capCents: cents(480_000) });
      const feasibleAt4800 = enumerateCandidates(scopeChangeCandidates, financeView4800, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(feasibleAt4800.items.map((c) => c.candidateKey)).toEqual(['audit_log_export+sso_login']);

      // Under $4,700 cap ($700 headroom): 0 candidates fit in finance view
      const financeView4700 = viewForRoleFromFixture(main, 'finance', { capCents: cents(470_000) });
      const feasibleAt4700 = enumerateCandidates(scopeChangeCandidates, financeView4700, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(feasibleAt4700.items).toEqual([]);
    });

    it('matches the 16 -> 12 truncation golden table on canaryFixture in snapshot mode and has no limit in feasibility mode (14 §11 F, CN-003)', () => {
      const canaryProviderView = viewForRoleFromFixture(canaryFixture, 'provider');
      expect(canaryProviderView.deadline).toBeUndefined();

      // Raw candidate space has 8 subsets * 2 (base + rush) = 16 drafts
      const space = candidateSpace(canaryProviderView);
      expect(space.drafts).toHaveLength(16);

      // Feasibility mode has no limit -> returns all 16 candidates
      const feasibleAll = enumerateCandidates(scopeChangeCandidates, canaryProviderView, {
        mode: 'feasibility',
      });
      expect(feasibleAll.items).toHaveLength(16);
      expect(feasibleAll.materialized).toHaveLength(16);

      // Snapshot mode caps at 12: O1 is anchor ($800), O2..O12 sorted by candidateKey code-unit order
      const snap = enumerateCandidates(scopeChangeCandidates, canaryProviderView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(snap.items).toHaveLength(12);
      expect(
        snap.items.map((s) => ({
          optionKey: s.optionKey,
          candidateKey: s.candidateKey,
          amountCents: s.amountCents,
          deliveryDate: s.deliveryDate,
        })),
      ).toEqual([
        { optionKey: 'O1', candidateKey: 'audit_log_export+sso_login', amountCents: 80_000, deliveryDate: '2026-11-16' },
        { optionKey: 'O2', candidateKey: 'audit_log_export+custom_theme+slack_alerts+sso_login', amountCents: 130_000, deliveryDate: '2026-12-04' },
        { optionKey: 'O3', candidateKey: 'audit_log_export+custom_theme+sso_login', amountCents: 105_000, deliveryDate: '2026-12-04' },
        { optionKey: 'O4', candidateKey: 'audit_log_export+custom_theme+sso_login+usage_dashboard', amountCents: 115_000, deliveryDate: '2026-12-04' },
        { optionKey: 'O5', candidateKey: 'audit_log_export+custom_theme+sso_login+usage_dashboard@rush', amountCents: 130_000, deliveryDate: '2026-11-30' },
        { optionKey: 'O6', candidateKey: 'audit_log_export+custom_theme+sso_login@rush', amountCents: 120_000, deliveryDate: '2026-11-30' },
        { optionKey: 'O7', candidateKey: 'audit_log_export+slack_alerts+sso_login', amountCents: 105_000, deliveryDate: '2026-11-27' },
        { optionKey: 'O8', candidateKey: 'audit_log_export+slack_alerts+sso_login+usage_dashboard', amountCents: 115_000, deliveryDate: '2026-11-27' },
        { optionKey: 'O9', candidateKey: 'audit_log_export+slack_alerts+sso_login@rush', amountCents: 120_000, deliveryDate: '2026-11-23' },
        { optionKey: 'O10', candidateKey: 'audit_log_export+sso_login+usage_dashboard', amountCents: 90_000, deliveryDate: '2026-11-18' },
        { optionKey: 'O11', candidateKey: 'audit_log_export+sso_login+usage_dashboard@rush', amountCents: 105_000, deliveryDate: '2026-11-14' },
        { optionKey: 'O12', candidateKey: 'audit_log_export+sso_login@rush', amountCents: 95_000, deliveryDate: '2026-11-12' },
      ]);
    });

    it('rejects system view in snapshot mode and allows it in feasibility mode (i09)', () => {
      const sysView = systemViewFromFixture(main);
      expect(() =>
        enumerateCandidates(scopeChangeCandidates, sysView, {
          roundNo: 1,
          turnKind: 'propose',
        }),
      ).toThrow(/system_view_in_snapshot_mode/);

      const feasible = enumerateCandidates(scopeChangeCandidates, sysView, {
        mode: 'feasibility',
      });
      expect(feasible.items.map((c) => c.candidateKey)).toEqual([
        'audit_log_export+sso_login',
        'audit_log_export+sso_login+usage_dashboard',
      ]);
    });

    it('validates cents, dates, and catalog provenance at the viewFor boundary (i06)', () => {
      const sysView = systemViewFromFixture(main);

      // Invalid localDate
      expect(() =>
        viewFor(
          scopeChangeCandidates,
          { ...sysView, localDate: '2026-02-30' as typeof sysView.localDate },
          main.briefs.customer.disclosures,
          'provider',
        ),
      ).toThrow();

      // Invalid capCents (negative or fractional)
      expect(() =>
        viewFor(
          scopeChangeCandidates,
          { ...sysView, capCents: -100 as typeof sysView.capCents },
          main.briefs.customer.disclosures,
          'finance',
        ),
      ).toThrow();

      // Missing catalog provenance
      const missingProvenanceCatalog = main.catalog.map((row) => ({
        itemKey: row.itemKey,
        title: row.title,
        priceCents: row.priceCents,
        leadDays: row.leadDays,
        status: row.status,
        revision: row.revision,
      }));
      expect(() =>
        viewFor(
          scopeChangeCandidates,
          {
            ...sysView,
            catalog: missingProvenanceCatalog as unknown as typeof sysView.catalog,
          },
          main.briefs.customer.disclosures,
          'provider',
        ),
      ).toThrow(PluginContractError);
    });

    it('rejects invalid catalog row status, kind, revision, and leadDays in normalizeCatalogRow (i12)', () => {
      const baseRow = main.catalog[0]!;

      // Valid confirmed and retired rows with boundary leadDays 0 and 365 pass
      expect(normalizeCatalogRow({ ...baseRow, status: 'confirmed', leadDays: 0 }, 'provider').leadDays).toBe(0);
      expect(normalizeCatalogRow({ ...baseRow, status: 'retired', leadDays: 365 }, 'provider').status).toBe('retired');

      // 1. status outside {confirmed, retired} (06 §5.1: drafts never enter RuleInput)
      for (const badStatus of ['draft', 'pending', '', undefined]) {
        expect(() =>
          normalizeCatalogRow(
            { ...baseRow, status: badStatus as typeof baseRow.status },
            'provider',
          ),
        ).toThrow(new PluginContractError('invalid_catalog_status'));
      }

      // 2. unknown kind outside {item, modifier}
      for (const badKind of ['addon', 'bundle', '', undefined]) {
        expect(() =>
          normalizeCatalogRow(
            { ...baseRow, kind: badKind as typeof baseRow.kind },
            'provider',
          ),
        ).toThrow(new PluginContractError('invalid_catalog_kind'));
      }

      // 3. non-integer or non-positive revision
      for (const badRevision of [1.5, NaN, Infinity, 0, -1, '1' as unknown as number]) {
        expect(() =>
          normalizeCatalogRow({ ...baseRow, revision: badRevision }, 'provider'),
        ).toThrow(new PluginContractError('invalid_catalog_revision'));
      }

      // 4. leadDays outside 0..365 or non-integer
      for (const badLeadDays of [-1, 366, 1.5, NaN, Infinity, '10' as unknown as number]) {
        expect(() =>
          normalizeCatalogRow({ ...baseRow, leadDays: badLeadDays }, 'provider'),
        ).toThrow(new PluginContractError('invalid_lead_days'));
      }
    });

    it('exports canonical scope_change protocol and catalog declarations per 14 §3 / §5 and CN-004 #4 (i13)', () => {
      expect(catalog.maxTaskTemplatesPerRow).toBe(5);
      expect(catalog.ownerRole).toBe('provider');
      expect(catalog.maxItemRows).toBe(12);
      expect(catalog.maxModifierRows).toBe(2);

      // 14 §3 & CN-004 #4: item_scope was deleted and no role may ask option_fits_constraints
      expect(protocol.topics).toMatchObject([
        { topicKey: 'item_required', toRole: 'customer', askableBy: ['provider', 'finance'] },
        { topicKey: 'deadline_value', toRole: 'customer', askableBy: ['provider', 'finance'] },
        { topicKey: 'budget_room', toRole: 'finance', askableBy: ['customer'] },
      ]);
      expect(protocol.topics.map((t) => t.topicKey)).not.toContain('item_scope');
      expect(protocol.topics.map((t) => t.topicKey)).not.toContain('option_fits_constraints');

      expect(protocol.reasonKeys).toEqual([
        { reasonKey: 'cannot_deliver', usableBy: ['provider'] },
        { reasonKey: 'missing_required_item', usableBy: ['customer'] },
        { reasonKey: 'after_deadline', usableBy: ['customer'] },
        { reasonKey: 'preference_not_met', usableBy: ['customer'] },
        { reasonKey: 'over_budget', usableBy: ['finance'] },
        { reasonKey: 'price_too_high', usableBy: ['finance', 'customer'] },
        { reasonKey: 'terms_not_acceptable', usableBy: ['human'] },
        { reasonKey: 'scope_insufficient', usableBy: ['human'] },
        { reasonKey: 'needs_earlier_delivery', usableBy: ['human'] },
        { reasonKey: 'other', usableBy: ['human'] },
        { reasonKey: 'over_our_limit', usableBy: ['human'] },
      ]);

      // 14 §3: three static English roleCharters containing zero digits and zero private values
      expect(Object.keys(protocol.roleCharters).sort()).toEqual(['customer', 'finance', 'provider']);
      for (const role of ['customer', 'provider', 'finance'] as const) {
        const charter = protocol.roleCharters[role];
        expect(typeof charter).toBe('string');
        expect(charter!.length).toBeGreaterThan(20);
        expect(/\d/.test(charter!)).toBe(false);
      }
    });
  });

  describe('2. Rush variant rules (S-D3, 14 §6.1) and materialized line sorting (i08)', () => {
    it('does not generate rush variants when base variant already meets disclosed deadline', () => {
      const providerView = viewForRoleFromFixture(main, 'provider');
      const space = candidateSpace(providerView);

      const keys = space.drafts.map((d) =>
        d.modifiers.length ? `${d.itemKeys.join('+')}@${d.modifiers.join('+')}` : d.itemKeys.join('+'),
      );
      expect(keys).not.toContain('audit_log_export+sso_login@rush');
      expect(keys).not.toContain('audit_log_export+sso_login+usage_dashboard@rush');

      expect(keys).toContain('audit_log_export+slack_alerts+sso_login@rush');
      expect(keys).toContain('audit_log_export+custom_theme+sso_login@rush');

      const reqRushExp = proposalExpectations.find((e) => e.id === 'required-rush');
      expect(reqRushExp?.notEnumeratedBecause).toBe('base_meets_deadline');
    });

    it('generates and selects rush variants when base delivery exceeds deadline and sorts materialized lines by itemKey (i08)', () => {
      const tightDeadlineView = viewForRoleFromFixture(main, 'provider', {
        deadline: addDays(isoDate(main.goldenAnchor), 12), // 2026-11-14
      });

      const snap = enumerateCandidates(scopeChangeCandidates, tightDeadlineView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(snap.items).toEqual([
        {
          optionKey: 'O1',
          candidateKey: 'audit_log_export+sso_login@rush',
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: ['rush'],
          amountCents: 95_000,
          deliveryDate: '2026-11-12',
        },
        {
          optionKey: 'O2',
          candidateKey: 'audit_log_export+sso_login+usage_dashboard@rush',
          itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
          modifiers: ['rush'],
          amountCents: 105_000,
          deliveryDate: '2026-11-14',
        },
      ]);

      // i08: materialized lines are sorted by itemKey across items + modifiers ('audit_log_export', 'rush', 'sso_login')
      expect(snap.materialized[0]?.lines.map((l) => l.itemKey)).toEqual([
        'audit_log_export',
        'rush',
        'sso_login',
      ]);
    });

    it('returns empty snapshot with item.required_missing without throwing when a required item is retired', () => {
      const retiredCatalog = main.catalog.map((r) =>
        r.itemKey === 'audit_log_export' ? { ...r, status: 'retired' as const, revision: 2 } : r,
      );
      const view = viewForRoleFromFixture(main, 'provider', { catalog: retiredCatalog });
      const snap = enumerateCandidates(scopeChangeCandidates, view, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(snap.items).toEqual([]);
      expect(snap.emptyReasons).toEqual(['item.required_missing']);
    });
  });

  describe('3. The $4,800 walkthrough (S7–S8: $900 blocked -> only $800 remains)', () => {
    it('walks through S7–S8: cap cut to $4,800 -> round 1 provider proposes $900 -> blocked by budget.over -> excluded in round 2 -> only $800 remains and passes at exact cap', () => {
      const sharedWishlist = {
        preferredItemKeys: main.briefs.customer.softFields.preferredItemKeys,
      };
      const customerOwnSoft = main.briefs.customer.softFields;
      const providerOwnSoft = main.briefs.provider.softFields;
      const financeOwnSoft = main.briefs.finance.softFields;

      // S7: Finance cuts cap from $5,000 (500,000) to $4,800 (480,000); baseline committed is $4,000 (400,000).
      const systemViewV2 = systemViewFromFixture(main, { capCents: cents(480_000) });
      const providerViewV2 = viewForRoleFromFixture(main, 'provider', { capCents: cents(480_000) });
      const customerViewV2 = viewForRoleFromFixture(main, 'customer', { capCents: cents(480_000) });
      const financeViewV2 = viewForRoleFromFixture(main, 'finance', { capCents: cents(480_000) });

      // Global feasibility precheck at start of Run 2 has [$800]
      const globalFeasible = enumerateCandidates(scopeChangeCandidates, systemViewV2, {
        mode: 'feasibility',
      });
      expect(globalFeasible.items.map((c) => c.candidateKey)).toEqual(['audit_log_export+sso_login']);

      // S7 -> S8 Round 1: Provider enumerates with empty excludedCandidateKeys (D12: v1 not pre-excluded by new cv)
      const excludedCandidateKeys: string[] = [];
      const round1Snap = enumerateCandidates(scopeChangeCandidates, providerViewV2, {
        roundNo: 1,
        turnKind: 'propose',
        excludedCandidateKeys,
      });
      expect(
        round1Snap.items.map((c) => ({
          optionKey: c.optionKey,
          candidateKey: c.candidateKey,
          amountCents: c.amountCents,
        })),
      ).toEqual([
        { optionKey: 'O1', candidateKey: 'audit_log_export+sso_login', amountCents: 80_000 },
        {
          optionKey: 'O2',
          candidateKey: 'audit_log_export+sso_login+usage_dashboard',
          amountCents: 90_000,
        },
      ]);

      // Provider stub picks O2 ($900) because it overlaps with disclosed wishlist ('usage_dashboard')
      const round1Decision = stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: round1Snap.items,
        currentProposal: null,
        ownSoft: providerOwnSoft,
        sharedSoft: sharedWishlist,
        allowedActions: allowedActions('provider', 'propose', actionCtx(round1Snap.items.length)),
      });
      expect(round1Decision).toEqual({
        turn: {
          action: 'propose',
          optionKey: 'O2',
          rationale: 'stub: most wishlist items, then lowest price',
        },
      });
      expect('action' in round1Decision).toBe(false);
      expect(Object.getOwnPropertyNames(round1Decision)).toEqual(['turn']);

      // Server resolves O2 inside round1Snap and materializes on room localDate
      const round1Mat = materializeSelectedOption(
        scopeChangeCandidates,
        round1Snap.items,
        round1Decision.turn.action === 'propose' ? round1Decision.turn.optionKey : '',
        main.catalog,
        main.goldenAnchor,
        excludedCandidateKeys,
      );
      expect(round1Mat.ok).toBe(true);
      if (!round1Mat.ok) throw new Error('expected round 1 materialization to succeed');
      expect(round1Mat.snapshotEntry.candidateKey).toBe(
        'audit_log_export+sso_login+usage_dashboard',
      );
      expect(round1Mat.materialized.terms.amountCents).toBe(90_000);

      // Global checkProposal against cv 2 ($4,800 cap): blocked by budget.over (400,000 + 90,000 = 490,000 > 480,000)
      const round1Eval = checkProposal(testScenarioPlugin, systemViewV2, round1Mat.materialized);
      expect(round1Eval.passesChecks).toBe(false);
      expect(round1Eval.blocking).toEqual(['budget.over']);
      expect(round1Eval.amounts.overByCents).toBe(10_000);

      // Blocked candidateKey is added to excludedCandidateKeys for the run
      excludedCandidateKeys.push(round1Mat.snapshotEntry.candidateKey);

      // S8 Round 2: Provider enumerates with $900 excluded; only $800 remains as O1
      const round2Snap = enumerateCandidates(scopeChangeCandidates, providerViewV2, {
        roundNo: 2,
        turnKind: 'propose',
        excludedCandidateKeys,
      });
      expect(round2Snap.items).toEqual([
        {
          optionKey: 'O1',
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: [],
          amountCents: 80_000,
          deliveryDate: '2026-11-16',
        },
      ]);

      // Provider stub selects O1 ($800)
      const round2Decision = stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: round2Snap.items,
        currentProposal: null,
        ownSoft: providerOwnSoft,
        sharedSoft: sharedWishlist,
        allowedActions: allowedActions('provider', 'propose', actionCtx(round2Snap.items.length)),
      });
      expect(round2Decision.turn).toEqual({
        action: 'propose',
        optionKey: 'O1',
        rationale: 'stub: most wishlist items, then lowest price',
      });

      // Server resolves O1 inside round2Snap and materializes v2 ($800)
      const round2Mat = materializeSelectedOption(
        scopeChangeCandidates,
        round2Snap.items,
        round2Decision.turn.action === 'propose' ? round2Decision.turn.optionKey : '',
        main.catalog,
        main.goldenAnchor,
        excludedCandidateKeys,
      );
      expect(round2Mat.ok).toBe(true);
      if (!round2Mat.ok) throw new Error('expected round 2 materialization to succeed');
      expect(round2Mat.materialized.terms).toEqual({
        itemKeys: ['audit_log_export', 'sso_login'],
        modifiers: [],
        amountCents: 80_000,
        deliveryDate: '2026-11-16',
      });

      // Global checkProposal: 400,000 + 80,000 = 480,000 <= 480,000 (passes at exact cap!)
      const round2Eval = checkProposal(testScenarioPlugin, systemViewV2, round2Mat.materialized);
      expect(round2Eval.passesChecks).toBe(true);
      expect(round2Eval.blocking).toEqual([]);
      expect(round2Eval.amounts.committedAfterCents).toBe(480_000);
      expect(round2Eval.amounts.headroomCents).toBe(80_000);

      // S8/S9 Customer evaluation turn: excludes base v2 ($800) and excludedCandidateKeys ($900) -> empty snapshot
      const customerSnap = enumerateCandidates(scopeChangeCandidates, customerViewV2, {
        roundNo: 2,
        turnKind: 'evaluate',
        baseCandidateKey: round2Mat.materialized.candidateKey,
        excludedCandidateKeys,
      });
      expect(customerSnap.items).toEqual([]);
      const customerAllowed = allowedActions('customer', 'evaluate', actionCtx(customerSnap.items.length));
      expect(customerAllowed).not.toContain('counter');

      const customerEvalInView = checkProposal(
        testScenarioPlugin,
        customerViewV2,
        round2Mat.materialized,
      );
      expect(customerEvalInView.passesChecks).toBe(true);

      const customerDecision = stubDecide({
        role: 'customer',
        turnKind: 'evaluate',
        snapshot: customerSnap.items,
        currentProposal: {
          version: 2,
          candidateKey: round2Mat.materialized.candidateKey,
          itemKeys: round2Mat.materialized.terms.itemKeys,
          passesInMyView: customerEvalInView.passesChecks,
        },
        ownSoft: customerOwnSoft,
        sharedSoft: {},
        allowedActions: customerAllowed,
      });
      expect(customerDecision.turn).toEqual({
        action: 'recommend_accept',
        proposalVersion: 2,
        rationale: 'stub: as good as my best option',
      });

      // S9 Finance evaluation turn: empty snapshot, passes in finance view -> recommend_accept
      const financeSnap = enumerateCandidates(scopeChangeCandidates, financeViewV2, {
        roundNo: 2,
        turnKind: 'evaluate',
        baseCandidateKey: round2Mat.materialized.candidateKey,
        excludedCandidateKeys,
      });
      expect(financeSnap.items).toEqual([]);

      const financeEvalInView = checkProposal(
        testScenarioPlugin,
        financeViewV2,
        round2Mat.materialized,
      );
      expect(financeEvalInView.passesChecks).toBe(true);

      const financeDecision = stubDecide({
        role: 'finance',
        turnKind: 'evaluate',
        snapshot: financeSnap.items,
        currentProposal: {
          version: 2,
          candidateKey: round2Mat.materialized.candidateKey,
          itemKeys: round2Mat.materialized.terms.itemKeys,
          passesInMyView: financeEvalInView.passesChecks,
        },
        ownSoft: financeOwnSoft,
        sharedSoft: {},
        allowedActions: allowedActions('finance', 'evaluate', actionCtx(financeSnap.items.length)),
      });
      expect(financeDecision.turn).toEqual({
        action: 'recommend_accept',
        proposalVersion: 2,
        rationale: 'stub: passes my checks',
      });
    });
  });

  describe('4. resolveOptionKey and materializeSelectedOption', () => {
    it('resolves valid optionKeys strictly within the snapshot and returns null for out-of-snapshot or malformed keys', () => {
      const providerView = viewForRoleFromFixture(main, 'provider');
      const snap = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      }).items;

      expect(isOptionKey('O1')).toBe(true);
      expect(isOptionKey('O12')).toBe(true);
      expect(isOptionKey('O0')).toBe(false);
      expect(isOptionKey('O13')).toBe(false);
      expect(isOptionKey('opt_1')).toBe(false);

      const o1 = resolveOptionKey(snap, 'O1');
      expect(o1?.candidateKey).toBe('audit_log_export+sso_login');
      expect(o1?.amountCents).toBe(80_000);

      const o2 = resolveOptionKey(snap, 'O2');
      expect(o2?.candidateKey).toBe('audit_log_export+sso_login+usage_dashboard');
      expect(o2?.amountCents).toBe(90_000);

      // O3..O12 are not in this 2-item snapshot
      expect(resolveOptionKey(snap, 'O3')).toBeNull();
      expect(resolveOptionKey(snap, 'O9')).toBeNull();
      expect(resolveOptionKey(snap, 'audit_log_export+sso_login')).toBeNull();

      expect(resolveOptionKeyWithReason(snap, 'O9')).toEqual({
        ok: false,
        code: 'action.option_not_in_snapshot',
      });
      expect(
        resolveOptionKeyWithReason(snap, 'O2', ['audit_log_export+sso_login+usage_dashboard']),
      ).toEqual({
        ok: false,
        code: 'action.repeats_blocked',
      });
    });

    it('materializes a resolved option on a rolled localDate (midnight crossing) and flags deliveryDateShifted', () => {
      const providerView = viewForRoleFromFixture(main, 'provider');
      const snap = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      }).items; // enumerated on 2026-11-02 -> O1 deliveryDate is 2026-11-16

      // Turn completes after midnight on 2026-11-03 (D22)
      const rolled = materializeSelectedOption(
        scopeChangeCandidates,
        snap,
        'O1',
        main.catalog,
        '2026-11-03',
      );
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) throw new Error('expected materialization to succeed');
      expect(rolled.deliveryDateShifted).toBe(true);
      expect(rolled.snapshotEntry.deliveryDate).toBe('2026-11-16');
      expect(rolled.materialized.terms.deliveryDate).toBe('2026-11-17');
      expect(rolled.materialized.terms.amountCents).toBe(80_000);
      expect(rolled.materialized.plannedTasks).toEqual([
        {
          itemKey: 'audit_log_export',
          templateIndex: 0,
          title: 'Build audit log CSV export',
          assigneeRole: 'provider',
          dueDate: '2026-11-17',
        },
        {
          itemKey: 'sso_login',
          templateIndex: 0,
          title: 'Implement SAML SSO login',
          assigneeRole: 'provider',
          dueDate: '2026-11-17',
        },
      ]);
    });
  });

  describe('5. stubDecide determinism, decision table coverage, and scenario plugin requirements (i02, i05)', () => {
    it('is 100% deterministic: identical inputs produce identical plain { turn } outputs across repeated runs (i05)', () => {
      const providerView = viewForRoleFromFixture(main, 'provider');
      const snap = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      }).items;

      const inputs = [
        {
          role: 'provider' as const,
          turnKind: 'propose' as const,
          snapshot: snap,
          currentProposal: null,
          ownSoft: main.briefs.provider.softFields,
          sharedSoft: { preferredItemKeys: ['slack_alerts', 'usage_dashboard'] },
          allowedActions: allowedActions('provider', 'propose', actionCtx(snap.length)),
        },
        {
          role: 'provider' as const,
          turnKind: 'propose' as const,
          snapshot: [],
          currentProposal: null,
          ownSoft: main.briefs.provider.softFields,
          sharedSoft: { preferredItemKeys: ['slack_alerts', 'usage_dashboard'] },
          allowedActions: allowedActions('provider', 'propose', actionCtx(0)),
        },
        {
          role: 'customer' as const,
          turnKind: 'evaluate' as const,
          snapshot: snap.slice(0, 1),
          currentProposal: {
            version: 1,
            candidateKey: 'audit_log_export+sso_login',
            itemKeys: ['audit_log_export', 'sso_login'],
            passesInMyView: true,
          },
          ownSoft: { preferredItemKeys: ['usage_dashboard'], notes: '' },
          sharedSoft: {},
          allowedActions: allowedActions('customer', 'evaluate', actionCtx(snap.slice(0, 1).length)),
        },
        {
          role: 'finance' as const,
          turnKind: 'evaluate' as const,
          snapshot: [],
          currentProposal: {
            version: 1,
            candidateKey: 'audit_log_export+sso_login+usage_dashboard',
            itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
            passesInMyView: false,
          },
          ownSoft: main.briefs.finance.softFields,
          sharedSoft: {},
          allowedActions: allowedActions('finance', 'evaluate', actionCtx(0)),
        },
      ];

      for (const input of inputs) {
        const baseline = stubDecide(input);
        expect(Object.getOwnPropertyNames(baseline)).toEqual(['turn']);
        for (let i = 0; i < 50; i++) {
          const next = stubDecide(input);
          expect(next).toEqual(baseline);
        }
      }
    });

    it('covers all provider, customer, and finance branches and canary rationale markers', () => {
      const providerView = viewForRoleFromFixture(main, 'provider');
      const snap = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      }).items; // O1: $800, O2: $900 (+usage_dashboard)

      // 1. Provider with no disclosed wishlist picks cheapest (O1 $800)
      const pCheapest = stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: snap,
        currentProposal: null,
        ownSoft: { preferredItemKeys: ['usage_dashboard'] }, // provider ignores ownSoft wishlist, only reads sharedSoft!
        sharedSoft: {},
        allowedActions: ['propose', 'clarify', 'reject', 'escalate'],
      });
      expect(pCheapest.turn).toEqual({
        action: 'propose',
        optionKey: 'O1',
        rationale: 'stub: most wishlist items, then lowest price',
      });

      // 2. Provider with empty snapshot escalates infeasible to customer
      const pEmpty = stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: [],
        currentProposal: null,
        ownSoft: {},
        sharedSoft: {},
        allowedActions: ['propose', 'clarify', 'reject', 'escalate'],
      });
      expect(pEmpty.turn).toEqual({
        action: 'escalate',
        kind: 'infeasible',
        toRole: 'customer',
        rationale: 'stub: no candidate in my view',
      });

      // 3. Customer counters when snapshot has an option with more wishlist items than currentProposal
      const cCounter = stubDecide({
        role: 'customer',
        turnKind: 'evaluate',
        snapshot: [snap[1]!], // O2 has usage_dashboard
        currentProposal: {
          version: 1,
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          passesInMyView: true,
        },
        ownSoft: { preferredItemKeys: ['usage_dashboard'] },
        sharedSoft: {},
        allowedActions: ['recommend_accept', 'counter', 'reject', 'clarify', 'escalate'],
      });
      expect(cCounter.turn).toEqual({
        action: 'counter',
        optionKey: 'O2',
        baseProposalVersion: 1,
        rationale: 'stub: prefer my best option',
      });

      // 4. Customer rejects with preference_not_met when current proposal fails or is worse and counter is not allowed
      const cReject = stubDecide({
        role: 'customer',
        turnKind: 'evaluate',
        snapshot: [],
        currentProposal: {
          version: 1,
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          passesInMyView: false,
        },
        ownSoft: { preferredItemKeys: ['usage_dashboard'] },
        sharedSoft: {},
        allowedActions: ['recommend_accept', 'reject', 'clarify', 'escalate'],
      });
      expect(cReject.turn).toEqual({
        action: 'reject',
        proposalVersion: 1,
        reasonKey: 'preference_not_met',
        rationale: 'stub: no better option',
      });

      // 5. Finance rejects with over_budget when passesInMyView is false
      const fReject = stubDecide({
        role: 'finance',
        turnKind: 'evaluate',
        snapshot: [],
        currentProposal: {
          version: 1,
          candidateKey: 'audit_log_export+sso_login+usage_dashboard',
          itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
          passesInMyView: false,
        },
        ownSoft: {},
        sharedSoft: {},
        allowedActions: ['recommend_accept', 'reject', 'clarify', 'escalate'],
      });
      expect(fReject.turn).toEqual({
        action: 'reject',
        proposalVersion: 1,
        reasonKey: 'over_budget',
        rationale: 'stub: fails my checks',
      });

      // 6. Canary fixture appends CANARY-RAT-<role> to rationale
      const canaryProviderDec = stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: snap,
        currentProposal: null,
        ownSoft: canaryFixture.briefs.provider.softFields,
        sharedSoft: {
          preferredItemKeys: canaryFixture.briefs.customer.softFields.preferredItemKeys,
        },
      });
      expect(canaryProviderDec.turn.rationale).toContain(CANARY_RATIONALE.provider);

      const canaryCustomerDec = stubDecide({
        role: 'customer',
        turnKind: 'evaluate',
        snapshot: [],
        currentProposal: {
          version: 1,
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          passesInMyView: true,
        },
        ownSoft: canaryFixture.briefs.customer.softFields,
        sharedSoft: {},
      });
      expect(canaryCustomerDec.turn.rationale).toContain(CANARY_RATIONALE.customer);

      const canaryFinanceDec = stubDecide({
        role: 'finance',
        turnKind: 'evaluate',
        snapshot: [],
        currentProposal: {
          version: 1,
          candidateKey: 'audit_log_export+sso_login',
          itemKeys: ['audit_log_export', 'sso_login'],
          passesInMyView: true,
        },
        ownSoft: canaryFixture.briefs.finance.softFields,
        sharedSoft: {},
      });
      expect(canaryFinanceDec.turn.rationale).toContain(CANARY_RATIONALE.finance);
    });

    it('requires roles, fields, checks, candidateSpace, and materialize on the scenario plugin/slice and throws when missing (i02)', () => {
      const fullPlugin = {
        ...testScenarioPlugin,
        checks,
        candidateSpace,
        materialize,
        stubDecide,
      };
      const providerView = viewForRoleFromFixture(main, 'provider');

      // Missing roles/fields/checks throws invalid_scenario_slice
      const incompleteSlice = {
        candidateSpace,
        materialize,
        stubDecide,
      };
      expect(() =>
        enumerateCandidates(
          incompleteSlice as unknown as typeof scopeChangeCandidates,
          providerView,
          { roundNo: 1, turnKind: 'propose' },
        ),
      ).toThrow(/invalid_scenario_slice/);

      // Complete slice and full ScenarioPlugin produce identical results
      const snapSlice = enumerateCandidates(scopeChangeCandidates, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      const snapFullPlugin = enumerateCandidates(fullPlugin, providerView, {
        roundNo: 1,
        turnKind: 'propose',
      });
      expect(snapSlice.items.map((s) => s.candidateKey)).toEqual([
        'audit_log_export+sso_login',
        'audit_log_export+sso_login+usage_dashboard',
      ]);
      expect(snapFullPlugin.items).toEqual(snapSlice.items);

      // Finance evaluation turn produces an empty snapshot across both
      const financeView = viewForRoleFromFixture(main, 'finance');
      expect(
        enumerateCandidates(scopeChangeCandidates, financeView, {
          roundNo: 1,
          turnKind: 'evaluate',
        }).items,
      ).toEqual([]);
      expect(
        enumerateCandidates(fullPlugin, financeView, {
          roundNo: 1,
          turnKind: 'evaluate',
        }).items,
      ).toEqual([]);

      // Base proposal exclusion and excludedCandidateKeys work identically across both
      const customerView = viewForRoleFromFixture(main, 'customer');
      const evalSlice = enumerateCandidates(scopeChangeCandidates, customerView, {
        roundNo: 1,
        turnKind: 'evaluate',
        baseCandidateKey: 'audit_log_export+sso_login',
        excludedCandidateKeys: ['audit_log_export+sso_login+usage_dashboard'],
      });
      const evalPlugin = enumerateCandidates(fullPlugin, customerView, {
        roundNo: 1,
        turnKind: 'evaluate',
        baseCandidateKey: 'audit_log_export+sso_login',
        excludedCandidateKeys: ['audit_log_export+sso_login+usage_dashboard'],
      });
      expect(evalSlice.items).toEqual([]);
      expect(evalPlugin.items).toEqual([]);
    });
  });
});
