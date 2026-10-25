import { describe, expect, test } from 'vitest';
import {
  assertOptionsProjected,
  audienceParams,
  buildHumanRequests,
  cents,
  checkBudget,
  checkProposal,
  enumerateCandidates,
  evaluateApprovalSet,
  executionKey,
  hardProjection,
  isExecutable,
  isoDate,
  projectEvaluation,
  publicText,
  taskKey,
  verifyUntrustedBlock,
  viewFor,
  type ApprovalRow,
} from '@core/engine';
import {
  CANARY_RATIONALE,
  GOLDEN_ANCHOR,
  allowedActionsForTurn as allowedActions,
  canaryAmounts,
  canaryFixture,
  canarySecrets,
  delimitCatalogTitle,
  lintCanaries,
  main,
  materializeFixture,
  projectScopeChangeOptions,
  publicMoneyText,
  renderScopeChangeTemplate,
  retireCatalogRow,
  scopeChangePlugin,
  toRuleInput,
  validateBriefFields,
  validateCapCents,
  validateCatalogBatch,
  validateCatalogRow,
  variantByKey,
  type CatalogRowRecord,
  type PublicText,
} from '@core/scenarios/scope-change';

const { publicCents } = publicText;

const mergedDisclosures = {
  ...main.briefs.customer.disclosures,
  ...main.briefs.finance.disclosures,
};

const requiredApprovals = scopeChangePlugin.roles.map((r) => ({
  role: r.role,
  kind: r.approvalKind,
}));

const members = scopeChangePlugin.roles.map((r) => ({
  role: r.role,
  userId: `user_${r.role}`,
}));

describe('14 §10 S0–S13 pure pipeline arithmetic and ordering', () => {
  test('computes S0 through S13 candidate snapshots, stubDecide choices, checkProposal amounts, and approval set states — pure', () => {
    const materialized = materializeFixture(main, GOLDEN_ANCHOR);

    // S0–S2: Setup -> baseline recorded (400_000) -> 6 catalog rows confirmed
    expect(main.ledgerBaseline.amountCents).toBe(400_000);
    expect(validateCatalogBatch(main.catalog)).toEqual({ ok: true });
    const inputCv1 = toRuleInput(materialized as unknown as Record<string, unknown>);
    const sysViewMissingFinance = {
      ...inputCv1,
      capCents: undefined,
      headroomCents: undefined,
    };
    expect(scopeChangePlugin.readiness(sysViewMissingFinance)).toEqual([
      { gap: 'brief_field_missing', ownerRole: 'finance' },
    ]);

    // S3: All 3 briefs confirmed -> room open, cv = 1, Run 1 starts
    for (const role of main.confirmOrder) {
      expect(
        validateBriefFields(role, materialized.briefs[role], {
          localDate: isoDate(GOLDEN_ANCHOR),
          committedCents: cents(main.ledgerBaseline.amountCents),
          catalog: main.catalog,
        }),
      ).toEqual({ ok: true });
    }
    expect(scopeChangePlugin.readiness(inputCv1)).toEqual([]);
    const projCv1 = hardProjection(scopeChangePlugin, inputCv1);
    const snapOpts = { mode: 'snapshot' as const, roundNo: 1, turnKind: 'propose' as const, excludedCandidateKeys: [] };

    // Global feasibility at cv 1: [$800, $900]
    const globalFeasibleCv1 = enumerateCandidates(scopeChangePlugin, inputCv1, {
      ...snapOpts,
      mode: 'feasibility',
    });
    expect(globalFeasibleCv1.items.map((i) => i.amountCents)).toEqual([80_000, 90_000]);

    // S3 -> S4: Provider propose turn (Run 1, Round 1)
    const providerViewCv1 = viewFor(scopeChangePlugin, inputCv1, mergedDisclosures, 'provider');
    const providerSnapR1 = enumerateCandidates(scopeChangePlugin, providerViewCv1, snapOpts);
    expect(providerSnapR1.items).toEqual([
      {
        optionKey: 'O1',
        candidateKey: 'audit_log_export+sso_login',
        itemKeys: ['audit_log_export', 'sso_login'],
        modifiers: [],
        amountCents: cents(80_000),
        deliveryDate: isoDate('2026-11-16'),
      },
      {
        optionKey: 'O2',
        candidateKey: 'audit_log_export+sso_login+usage_dashboard',
        itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
        modifiers: [],
        amountCents: cents(90_000),
        deliveryDate: isoDate('2026-11-18'),
      },
    ]);

    const providerDecisionR1 = scopeChangePlugin.stubDecide({
      role: 'provider',
      turnKind: 'propose',
      snapshot: providerSnapR1.items,
      currentProposal: null,
      ownSoft: main.briefs.provider.softFields,
      sharedSoft: { preferredItemKeys: main.briefs.customer.softFields.preferredItemKeys },
      allowedActions: allowedActions('provider', 'propose', providerSnapR1.items.length),
    });
    expect(providerDecisionR1.turn).toMatchObject({
      action: 'propose',
      optionKey: 'O2',
    });

    // Materialize O2 -> Proposal v1 ($900, 2026-11-18)
    const chosenO2 = providerSnapR1.items.find((i) => i.optionKey === 'O2')!;
    const v1Materialized = scopeChangePlugin.materialize(
      { itemKeys: chosenO2.itemKeys, modifiers: chosenO2.modifiers },
      inputCv1.catalog,
      inputCv1.localDate,
    )!;
    expect(v1Materialized.terms).toEqual({
      itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
      modifiers: [],
      amountCents: cents(90_000),
      deliveryDate: isoDate('2026-11-18'),
    });
    expect(v1Materialized.lines).toHaveLength(3);
    expect(v1Materialized.plannedTasks).toHaveLength(3);

    const v1EvalCv1 = checkProposal(scopeChangePlugin, inputCv1, v1Materialized);
    expect(v1EvalCv1.passesChecks).toBe(true);
    expect(v1EvalCv1.blocking).toEqual([]);
    expect(v1EvalCv1.amounts).toEqual({
      amountCents: 90_000,
      capCents: 500_000,
      committedCents: 400_000,
      committedAfterCents: 490_000,
      headroomCents: 100_000,
    });

    // S5: Customer and Finance evaluate v1
    const customerViewCv1 = viewFor(scopeChangePlugin, inputCv1, mergedDisclosures, 'customer');
    const customerSnapR1 = enumerateCandidates(scopeChangePlugin, customerViewCv1, {
      ...snapOpts,
      turnKind: 'evaluate',
      excludedCandidateKeys: [v1Materialized.candidateKey],
    });
    expect(customerSnapR1.items.map((i) => i.amountCents)).toEqual([80_000]);

    const customerDecisionR1 = scopeChangePlugin.stubDecide({
      role: 'customer',
      turnKind: 'evaluate',
      snapshot: customerSnapR1.items,
      currentProposal: {
        version: 1,
        candidateKey: v1Materialized.candidateKey,
        itemKeys: v1Materialized.terms.itemKeys,
        passesInMyView: checkProposal(scopeChangePlugin, customerViewCv1, v1Materialized).passesChecks,
      },
      ownSoft: main.briefs.customer.softFields,
      sharedSoft: {},
      allowedActions: allowedActions('customer', 'evaluate', customerSnapR1.items.length),
    });
    expect(customerDecisionR1.turn).toMatchObject({
      action: 'recommend_accept',
      proposalVersion: 1,
    });

    const financeViewCv1 = viewFor(scopeChangePlugin, inputCv1, mergedDisclosures, 'finance');
    const financeDecisionR1 = scopeChangePlugin.stubDecide({
      role: 'finance',
      turnKind: 'evaluate',
      snapshot: [],
      currentProposal: {
        version: 1,
        candidateKey: v1Materialized.candidateKey,
        itemKeys: v1Materialized.terms.itemKeys,
        passesInMyView: checkProposal(scopeChangePlugin, financeViewCv1, v1Materialized).passesChecks,
      },
      ownSoft: main.briefs.finance.softFields,
      sharedSoft: {},
      allowedActions: allowedActions('finance', 'evaluate', 0),
    });
    expect(financeDecisionR1.turn).toMatchObject({
      action: 'recommend_accept',
      proposalVersion: 1,
    });

    // Both evaluators recommended accept -> run 1 transitions to pending_approval
    const v1ExecCheckCv1 = isExecutable(scopeChangePlugin, {
      room: { status: 'open', currentRunId: 'run_1' },
      run: { _id: 'run_1', status: 'pending_approval', currentProposalId: 'v1' },
      proposal: { ...v1Materialized, _id: 'v1', status: 'active' },
      input: inputCv1,
    });
    expect(v1ExecCheckCv1.ok).toBe(true);

    // S6: Customer and Provider approve v1 under cv 1
    const approvalsAfterS6: ApprovalRow[] = [
      {
        id: 'a1',
        userId: 'user_customer',
        role: 'customer',
        kind: 'terms',
        decision: 'approve',
        seq: 1,
        boundConstraintsVersion: 1,
        boundTermsKey: v1Materialized.termsKey,
      },
      {
        id: 'a2',
        userId: 'user_provider',
        role: 'provider',
        kind: 'terms',
        decision: 'approve',
        seq: 1,
        boundConstraintsVersion: 1,
        boundTermsKey: v1Materialized.termsKey,
      },
    ];
    const approvalSetS6 = evaluateApprovalSet({
      required: requiredApprovals,
      members,
      rows: approvalsAfterS6,
      roomConstraintsVersion: 1,
      termsKey: v1Materialized.termsKey,
    });
    expect(approvalSetS6.complete).toBe(false);
    expect(approvalSetS6.missingRoles).toEqual(['finance']);

    // S7: Finance lowers capCents from 500_000 to 480_000 -> cv = 2
    expect(validateCapCents(480_000, cents(400_000))).toEqual({ ok: true });
    const inputCv2 = {
      ...inputCv1,
      capCents: cents(480_000),
      headroomCents: 80_000,
    };
    const projCv2 = hardProjection(scopeChangePlugin, inputCv2);
    expect(projCv2).not.toBe(projCv1);

    // v1 becomes stale; a1 & a2 become stale_approve; isExecutable(v1) reports stale + budget.over
    const approvalSetS7 = evaluateApprovalSet({
      required: requiredApprovals,
      members,
      rows: approvalsAfterS6,
      roomConstraintsVersion: 2,
      termsKey: v1Materialized.termsKey,
    });
    expect(approvalSetS7.complete).toBe(false);
    expect(approvalSetS7.slots.filter((s) => s.slot.state === 'stale_approve')).toHaveLength(2);

    const v1ExecCheckCv2 = isExecutable(scopeChangePlugin, {
      room: { status: 'open', currentRunId: 'run_2' },
      run: { _id: 'run_2', status: 'pending_approval', currentProposalId: 'v1' },
      proposal: { ...v1Materialized, _id: 'v1', status: 'stale' },
      input: inputCv2,
    });
    expect(v1ExecCheckCv2).toEqual({ ok: false, reasons: [{ code: 'version.stale_constraints' }, { code: 'budget.over' }] });
    const v1EvaluationCv2 = checkProposal(scopeChangePlugin, inputCv2, v1Materialized);
    expect(v1EvaluationCv2.amounts.overByCents).toBe(10_000);

    // Customer view of v1 evaluation at cv 2 masks budget_fit as private.constraint_unmet
    const customerProjEvalS7 = projectEvaluation(
      v1EvaluationCv2,
      'customer',
      scopeChangePlugin,
      mergedDisclosures,
    );
    expect(customerProjEvalS7).toMatchObject({
      audience: 'buyer',
      passesChecks: false,
      masked: { code: 'private.constraint_unmet' },
    });

    // S8: Run 2 starts at cv 2
    // Round 1: Provider snapshot is still [O1: $800, O2: $900] because provider cannot see capCents
    const providerViewCv2 = viewFor(scopeChangePlugin, inputCv2, mergedDisclosures, 'provider');
    const providerSnapRun2R1 = enumerateCandidates(scopeChangePlugin, providerViewCv2, snapOpts);
    expect(providerSnapRun2R1.items.map((i) => i.amountCents)).toEqual([80_000, 90_000]);

    const providerDecisionRun2R1 = scopeChangePlugin.stubDecide({
      role: 'provider',
      turnKind: 'propose',
      snapshot: providerSnapRun2R1.items,
      currentProposal: null,
      ownSoft: main.briefs.provider.softFields,
      sharedSoft: { preferredItemKeys: main.briefs.customer.softFields.preferredItemKeys },
      allowedActions: allowedActions('provider', 'propose', providerSnapRun2R1.items.length),
    });
    expect(providerDecisionRun2R1.turn).toMatchObject({
      action: 'propose',
      optionKey: 'O2',
    });

    // Global checkProposal blocks O2 ($900) under cv 2 (490_000 > 480_000) -> not inserted, added to excludedCandidateKeys
    const blockedO2Eval = checkProposal(scopeChangePlugin, inputCv2, v1Materialized);
    expect(blockedO2Eval.passesChecks).toBe(false);
    expect(blockedO2Eval.blocking).toEqual(['budget.over']);
    const run2Excluded = [v1Materialized.candidateKey];

    // Round 2: Provider snapshot excludes $900 -> only [O1: $800, 2026-11-16]
    const providerSnapRun2R2 = enumerateCandidates(scopeChangePlugin, providerViewCv2, {
      ...snapOpts,
      roundNo: 2,
      excludedCandidateKeys: run2Excluded,
    });
    expect(providerSnapRun2R2.items).toHaveLength(1);
    expect(providerSnapRun2R2.items[0]!.amountCents).toBe(80_000);

    const providerDecisionRun2R2 = scopeChangePlugin.stubDecide({
      role: 'provider',
      turnKind: 'propose',
      snapshot: providerSnapRun2R2.items,
      currentProposal: null,
      ownSoft: main.briefs.provider.softFields,
      sharedSoft: { preferredItemKeys: main.briefs.customer.softFields.preferredItemKeys },
      allowedActions: allowedActions('provider', 'propose', providerSnapRun2R2.items.length),
    });
    expect(providerDecisionRun2R2.turn).toMatchObject({
      action: 'propose',
      optionKey: 'O1',
    });

    // Materialize O1 -> Proposal v2 ($800, 2026-11-16)
    const v2Materialized = scopeChangePlugin.materialize(
      { itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] },
      inputCv2.catalog,
      inputCv2.localDate,
    )!;
    expect(v2Materialized.terms).toEqual({
      itemKeys: ['audit_log_export', 'sso_login'],
      modifiers: [],
      amountCents: cents(80_000),
      deliveryDate: isoDate('2026-11-16'),
    });

    const v2EvalCv2 = checkProposal(scopeChangePlugin, inputCv2, v2Materialized);
    expect(v2EvalCv2.passesChecks).toBe(true);
    expect(v2EvalCv2.amounts).toEqual({
      amountCents: 80_000,
      capCents: 480_000,
      committedCents: 400_000,
      committedAfterCents: 480_000,
      headroomCents: 80_000,
    });

    // S9: Customer and Finance evaluate v2 (customer snapshot is empty after excluding v2 and $900)
    const customerViewCv2 = viewFor(scopeChangePlugin, inputCv2, mergedDisclosures, 'customer');
    const customerSnapRun2R2 = enumerateCandidates(scopeChangePlugin, customerViewCv2, {
      ...snapOpts,
      turnKind: 'evaluate',
      roundNo: 2,
      excludedCandidateKeys: [...run2Excluded, v2Materialized.candidateKey],
    });
    expect(customerSnapRun2R2.items).toEqual([]);

    const customerDecisionRun2R2 = scopeChangePlugin.stubDecide({
      role: 'customer',
      turnKind: 'evaluate',
      snapshot: customerSnapRun2R2.items,
      currentProposal: {
        version: 2,
        candidateKey: v2Materialized.candidateKey,
        itemKeys: v2Materialized.terms.itemKeys,
        passesInMyView: checkProposal(scopeChangePlugin, customerViewCv2, v2Materialized).passesChecks,
      },
      ownSoft: main.briefs.customer.softFields,
      sharedSoft: {},
      allowedActions: allowedActions('customer', 'evaluate', customerSnapRun2R2.items.length),
    });
    expect(customerDecisionRun2R2.turn).toMatchObject({
      action: 'recommend_accept',
      proposalVersion: 2,
    });

    const financeViewCv2 = viewFor(scopeChangePlugin, inputCv2, mergedDisclosures, 'finance');
    const financeDecisionRun2R2 = scopeChangePlugin.stubDecide({
      role: 'finance',
      turnKind: 'evaluate',
      snapshot: [],
      currentProposal: {
        version: 2,
        candidateKey: v2Materialized.candidateKey,
        itemKeys: v2Materialized.terms.itemKeys,
        passesInMyView: checkProposal(scopeChangePlugin, financeViewCv2, v2Materialized).passesChecks,
      },
      ownSoft: main.briefs.finance.softFields,
      sharedSoft: {},
      allowedActions: allowedActions('finance', 'evaluate', 0),
    });
    expect(financeDecisionRun2R2.turn).toMatchObject({
      action: 'recommend_accept',
      proposalVersion: 2,
    });

    // S10–S11: Three approvals a3, a4, a5 under cv 2 -> execution in same transaction
    const v2Approvals: ApprovalRow[] = [
      {
        id: 'a3',
        userId: 'user_customer',
        role: 'customer',
        kind: 'terms',
        decision: 'approve',
        seq: 1,
        boundConstraintsVersion: 2,
        boundTermsKey: v2Materialized.termsKey,
      },
      {
        id: 'a4',
        userId: 'user_provider',
        role: 'provider',
        kind: 'terms',
        decision: 'approve',
        seq: 1,
        boundConstraintsVersion: 2,
        boundTermsKey: v2Materialized.termsKey,
      },
      {
        id: 'a5',
        userId: 'user_finance',
        role: 'finance',
        kind: 'budget',
        decision: 'approve',
        seq: 1,
        boundConstraintsVersion: 2,
        boundTermsKey: v2Materialized.termsKey,
      },
    ];

    const v2ExecCheck = isExecutable(scopeChangePlugin, {
      room: { status: 'open', currentRunId: 'run_2' },
      run: { _id: 'run_2', status: 'pending_approval', currentProposalId: 'v2' },
      proposal: { ...v2Materialized, _id: 'v2', status: 'active' },
      input: inputCv2,
    });
    expect(v2ExecCheck.ok).toBe(true);

    const v2ApprovalSet = evaluateApprovalSet({
      required: requiredApprovals,
      members,
      rows: v2Approvals,
      roomConstraintsVersion: 2,
      termsKey: v2Materialized.termsKey,
    });
    expect(v2ApprovalSet.complete).toBe(true);
    expect(v2ApprovalSet.approvalIds).toEqual(['a3', 'a4', 'a5']);

    const finalBudgetCheck = checkBudget({
      amountCents: v2Materialized.terms.amountCents,
      committedCents: cents(400_000),
      capCents: cents(480_000),
    });
    expect(finalBudgetCheck).toEqual({
      ok: true,
      committedAfterCents: 480_000,
      headroomCents: 80_000,
    });

    expect(executionKey('v2')).toBe('exec:v2');
    const derivedTaskKeys = v2Materialized.plannedTasks.map((t) =>
      taskKey('exec_1', t.itemKey, t.templateIndex),
    );
    expect(derivedTaskKeys).toEqual(['exec_1:audit_log_export:0', 'exec_1:sso_login:0']);

    // S12–S13: After execution, v2 is executed and room is executed (cv remains 2)
    const afterExecCheck = isExecutable(scopeChangePlugin, {
      room: { status: 'executed', currentRunId: null },
      run: { _id: 'run_2', status: 'executed', currentProposalId: 'v2' },
      proposal: { ...v2Materialized, _id: 'v2', status: 'executed' },
      input: inputCv2,
    });
    expect(afterExecCheck.ok).toBe(false);
    expect(afterExecCheck).toEqual({ ok: false, reasons: [{ code: 'approval.already_executed' }] });
    expect(variantByKey('main').expected).toMatchObject({
      kind: 'execute_at_cap',
      capCents: 480_000,
      executedAmountCents: 80_000,
      committedAfterCents: 480_000,
      remainingCents: 0,
    });
  });
});

describe('14 §11 A–G pure arithmetic, feasibility, and relaxation checks', () => {
  const materialized = materializeFixture(main, GOLDEN_ANCHOR);
  const inputCv1 = toRuleInput(materialized as unknown as Record<string, unknown>);
  const snapOpts = { mode: 'snapshot' as const, roundNo: 1, turnKind: 'propose' as const, excludedCandidateKeys: [] };

  test('14 §11 A (cap_4700) — pure feasibility and finance raise_cap relaxation options', () => {
    const input4700 = {
      ...inputCv1,
      capCents: cents(470_000),
      headroomCents: 70_000,
    };
    const feasible4700 = enumerateCandidates(scopeChangePlugin, input4700, {
      ...snapOpts,
      mode: 'feasibility',
    });
    expect(feasible4700.items).toEqual([]);

    const baseRun = {
      excludedCandidateKeys: [] as readonly string[],
      providerExcludedCandidateKeys: [] as readonly string[],
      openRequestCount: 0,
      keepAsIsUsed: false,
      canContinue: true,
    };
    const req = buildHumanRequests(scopeChangePlugin, {
      kind: 'infeasible',
      full: input4700,
      viewOf: (role) => viewFor(scopeChangePlugin, input4700, mergedDisclosures, role),
      run: baseRun,
      disclosures: mergedDisclosures,
    });

    expect(req.toRole).toBe('finance');
    expect(req.options.map((o) => o.optionKey)).toEqual(['A', 'B', 'C']);
    expect(req.options[0]).toMatchObject({
      optionKey: 'A',
      templateKey: 'request.raise_cap',
      effect: { kind: 'raise_cap', amountCents: 480_000 },
      shown: {
        itemKeys: ['audit_log_export', 'sso_login'],
        amountCents: 80_000,
        deliveryDate: '2026-11-16',
        deltaCents: 10_000,
      },
    });
    expect(req.options[1]).toMatchObject({
      optionKey: 'B',
      templateKey: 'request.raise_cap',
      effect: { kind: 'raise_cap', amountCents: 490_000 },
      shown: {
        itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'],
        amountCents: 90_000,
        deliveryDate: '2026-11-18',
        deltaCents: 20_000,
      },
    });
    expect(req.options[2]?.effect).toEqual({ kind: 'end_run' });

    const financeView = viewFor(scopeChangePlugin, input4700, mergedDisclosures, 'finance');
    const projectedOpts = projectScopeChangeOptions(
      'finance',
      financeView,
      req.options.filter((o) => o.effect.kind !== 'end_run'),
    );
    expect(() => assertOptionsProjected('finance', projectedOpts)).not.toThrow();

    // Raising cap to 480_000 makes [$800] feasible
    expect(validateCapCents(480_000, cents(400_000))).toEqual({ ok: true });
    const inputCv3 = { ...input4700, capCents: cents(480_000), headroomCents: 80_000 };
    expect(
      enumerateCandidates(scopeChangePlugin, inputCv3, { ...snapOpts, mode: 'feasibility' }).items.map(
        (i) => i.amountCents,
      ),
    ).toEqual([80_000]);
  });

  test('14 §11 B (boundary_minus_one_cent) — pure 1-cent budget boundary and +$0.01 relaxation option', () => {
    const input479999 = {
      ...inputCv1,
      capCents: cents(479_999),
      headroomCents: 79_999,
    };
    const reqScope = scopeChangePlugin.materialize(
      { itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] },
      input479999.catalog,
      input479999.localDate,
    )!;
    const eval479999 = checkProposal(scopeChangePlugin, input479999, reqScope);
    expect(eval479999.passesChecks).toBe(false);
    expect(eval479999.blocking).toEqual(['budget.over']);
    expect(eval479999.amounts.overByCents).toBe(1);

    const req = buildHumanRequests(scopeChangePlugin, {
      kind: 'infeasible',
      full: input479999,
      viewOf: (role) => viewFor(scopeChangePlugin, input479999, mergedDisclosures, role),
      run: {
        excludedCandidateKeys: [],
        providerExcludedCandidateKeys: [],
        openRequestCount: 0,
        keepAsIsUsed: false,
        canContinue: true,
      },
      disclosures: mergedDisclosures,
    });
    expect(req.toRole).toBe('finance');
    expect(req.options[0]).toMatchObject({
      optionKey: 'A',
      effect: { kind: 'raise_cap', amountCents: 480_000 },
      shown: { amountCents: 80_000, deltaCents: 1 },
    });
    expect(req.options[1]).toMatchObject({
      optionKey: 'B',
      effect: { kind: 'raise_cap', amountCents: 490_000 },
      shown: { amountCents: 90_000, deltaCents: 10_001 },
    });
    expect(
      renderScopeChangeTemplate(
        'request.infeasible.finance',
        {
          capCents: publicCents(479_999),
          itemTitles: ['Audit log export', 'SSO login (SAML)'],
          cheapestAmountCents: publicCents(80_000),
          neededCapCents: publicCents(480_000),
        },
        'owner',
      ),
    ).toBe(
      'No option fits a $4,799.99 cap. The cheapest option (Audit log export + SSO login (SAML), $800) needs a cap of $4,800.',
    );
  });

  test('14 §11 C (below_committed) — pure validateCapCents boundary and owner-only minAllowedCapCents params', () => {
    const res = validateCapCents(390_000, cents(400_000));
    expect(res).toEqual({
      ok: false,
      code: 'budget.below_committed',
      params: { minAllowedCapCents: 400_000 },
    });
    if (!res.ok) {
      expect(audienceParams(res.code, 'finance', res.params)).toEqual({
        minAllowedCapCents: 400_000,
      });
      expect(audienceParams(res.code, 'customer', res.params)).toEqual({});
      expect(audienceParams(res.code, 'provider', res.params)).toEqual({});
    }

    // Boundary 400_000 is allowed (headroom 0), then pre-check is infeasible and asks finance to raise cap
    expect(validateCapCents(400_000, cents(400_000))).toEqual({ ok: true });
    const input4000 = { ...inputCv1, capCents: cents(400_000), headroomCents: 0 };
    const req = buildHumanRequests(scopeChangePlugin, {
      kind: 'infeasible',
      full: input4000,
      viewOf: (role) => viewFor(scopeChangePlugin, input4000, mergedDisclosures, role),
      run: {
        excludedCandidateKeys: [],
        providerExcludedCandidateKeys: [],
        openRequestCount: 0,
        keepAsIsUsed: false,
        canContinue: true,
      },
      disclosures: mergedDisclosures,
    });
    expect(req.toRole).toBe('finance');
    expect(req.options.slice(0, 2).map((o) => o.effect)).toEqual([
      { kind: 'raise_cap', amountCents: 480_000 },
      { kind: 'raise_cap', amountCents: 490_000 },
    ]);
  });

  test('14 §11 D (required_retired) — pure retireCatalogRow + toRuleInput path and customer drop_items relaxation', () => {
    const v1 = scopeChangePlugin.materialize(
      { itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'], modifiers: [] },
      inputCv1.catalog,
      inputCv1.localDate,
    )!;
    const retireRes = retireCatalogRow(
      'audit_log_export',
      materialized.catalog as unknown as CatalogRowRecord[],
    );
    expect(retireRes.ok).toBe(true);
    if (!retireRes.ok) throw new Error('retire failed');
    expect(retireRes.bumpsConstraints).toBe(true);
    expect(retireRes.retiredRow).toMatchObject({ status: 'retired', revision: 2, editNo: 0 });

    // Rebuild inputRetired through the real toRuleInput path (c01 + i10)
    const inputRetired = toRuleInput({
      ...(materialized as unknown as Record<string, unknown>),
      catalog: retireRes.rows,
    });
    expect(inputRetired.catalog.find((r) => r.itemKey === 'audit_log_export')?.status).toBe(
      'retired',
    );
    const v1ExecRetired = isExecutable(scopeChangePlugin, {
      room: { status: 'open', currentRunId: 'run_2' },
      run: { _id: 'run_2', status: 'pending_approval', currentProposalId: 'v1' },
      proposal: { ...v1, _id: 'v1', status: 'stale' },
      input: inputRetired,
    });
    expect(v1ExecRetired).toEqual({ ok: false, reasons: [
      { code: 'version.stale_constraints' },
      { code: 'item.retired' },
      { code: 'item.required_missing' },
    ] });
    expect(
      checkProposal(scopeChangePlugin, inputRetired, v1).checks.find((c) => c.checkId === 'required_offered')?.params,
    ).toMatchObject({ itemKeys: ['audit_log_export'], reason: 'not_offered' });

    expect(scopeChangePlugin.candidateSpace(inputRetired)).toEqual({
      drafts: [],
      emptyReasons: ['item.required_missing'],
    });

    const req = buildHumanRequests(scopeChangePlugin, {
      kind: 'infeasible',
      full: inputRetired,
      viewOf: (role) => viewFor(scopeChangePlugin, inputRetired, mergedDisclosures, role),
      run: {
        excludedCandidateKeys: [],
        providerExcludedCandidateKeys: [],
        openRequestCount: 0,
        keepAsIsUsed: false,
        canContinue: true,
      },
      disclosures: mergedDisclosures,
    });
    expect(req.toRole).toBe('customer');
    expect(req.options).toEqual([
      {
        optionKey: 'A',
        templateKey: 'request.drop_items',
        effect: { kind: 'drop_items', itemKeys: ['audit_log_export'] },
        shown: {
          itemKeys: ['sso_login'],
          modifiers: [],
          amountCents: cents(50_000),
          deliveryDate: isoDate('2026-11-13'),
        },
      },
      {
        optionKey: 'B',
        templateKey: 'request.pass_to_next',
        effect: { kind: 'pass_to_next', toRole: 'finance' },
        shown: {},
      },
      {
        optionKey: 'C',
        templateKey: 'request.end_run',
        effect: { kind: 'end_run' },
        shown: {},
      },
    ]);

    // D3: Customer drops audit_log_export -> provider snapshot is [$500, $600], stub picks O2 ($600)
    const inputAfterDrop = {
      ...inputRetired,
      requiredItemKeys: ['sso_login'],
    };
    const providerViewD3 = viewFor(scopeChangePlugin, inputAfterDrop, mergedDisclosures, 'provider');
    const snapD3 = enumerateCandidates(scopeChangePlugin, providerViewD3, snapOpts);
    expect(snapD3.items.map((i) => ({ key: i.candidateKey, amount: i.amountCents, date: i.deliveryDate }))).toEqual([
      { key: 'sso_login', amount: 50_000, date: '2026-11-13' },
      { key: 'sso_login+usage_dashboard', amount: 60_000, date: '2026-11-18' },
    ]);
    const decisionD3 = scopeChangePlugin.stubDecide({
      role: 'provider',
      turnKind: 'propose',
      snapshot: snapD3.items,
      currentProposal: null,
      ownSoft: main.briefs.provider.softFields,
      sharedSoft: { preferredItemKeys: main.briefs.customer.softFields.preferredItemKeys },
      allowedActions: allowedActions('provider', 'propose', snapD3.items.length),
    });
    expect(decisionD3.turn).toMatchObject({ action: 'propose', optionKey: 'O2' });
  });

  test('14 §11 E (midnight) — pure date_window check and extend_deadline Pareto frontier', () => {
    const v1 = scopeChangePlugin.materialize(
      { itemKeys: ['audit_log_export', 'sso_login', 'usage_dashboard'], modifiers: [] },
      inputCv1.catalog,
      inputCv1.localDate,
    )!;
    // E1: localDate 2026-11-03 -> deliveryDate 2026-11-18 still >= 2026-11-03
    const inputNov03 = { ...inputCv1, localDate: isoDate('2026-11-03') };
    expect(hardProjection(scopeChangePlugin, inputNov03)).toBe(
      hardProjection(scopeChangePlugin, inputCv1),
    );
    expect(checkProposal(scopeChangePlugin, inputNov03, v1).passesChecks).toBe(true);
    expect(v1.terms.deliveryDate).toBe('2026-11-18');

    // E2: localDate 2026-11-19 -> v1 fails date.in_past
    const inputNov19 = { ...inputCv1, localDate: isoDate('2026-11-19') };
    const evalNov19 = checkProposal(scopeChangePlugin, inputNov19, v1);
    expect(evalNov19.passesChecks).toBe(false);
    expect(evalNov19.blocking).toContain('date.in_past');

    // E3: at localDate 2026-11-19 (deadline 2026-11-20) -> extend_deadline frontier
    const customerViewNov19 = viewFor(scopeChangePlugin, inputNov19, mergedDisclosures, 'customer');
    const relaxationsNov19 = scopeChangePlugin.relaxations('customer', customerViewNov19, {
      kind: 'infeasible',
      excludedCandidateKeys: [],
    });
    expect(relaxationsNov19).toEqual([
      {
        optionKey: '',
        templateKey: 'request.extend_deadline',
        effect: { kind: 'extend_deadline', date: isoDate('2026-11-29') },
        shown: {
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: ['rush'],
          amountCents: cents(95_000),
          deliveryDate: isoDate('2026-11-29'),
        },
      },
      {
        optionKey: '',
        templateKey: 'request.extend_deadline',
        effect: { kind: 'extend_deadline', date: isoDate('2026-12-03') },
        shown: {
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: [],
          amountCents: cents(80_000),
          deliveryDate: isoDate('2026-12-03'),
        },
      },
    ]);
    const req = buildHumanRequests(scopeChangePlugin, {
      kind: 'infeasible',
      full: inputNov19,
      viewOf: (role) => viewFor(scopeChangePlugin, inputNov19, mergedDisclosures, role),
      run: {
        excludedCandidateKeys: [],
        providerExcludedCandidateKeys: [],
        openRequestCount: 0,
        keepAsIsUsed: false,
        canContinue: true,
      },
      disclosures: mergedDisclosures,
    });
    expect(req.toRole).toBe('customer');
    expect(req.options).toEqual([
      {
        optionKey: 'A',
        templateKey: 'request.extend_deadline',
        effect: { kind: 'extend_deadline', date: isoDate('2026-11-29') },
        shown: {
          itemKeys: ['audit_log_export', 'sso_login'],
          modifiers: ['rush'],
          amountCents: cents(95_000),
          deliveryDate: isoDate('2026-11-29'),
        },
      },
      {
        optionKey: 'B',
        templateKey: 'request.pass_to_next',
        effect: { kind: 'pass_to_next', toRole: 'finance' },
        shown: {},
      },
      {
        optionKey: 'C',
        templateKey: 'request.end_run',
        effect: { kind: 'end_run' },
        shown: {},
      },
    ]);

    // Extending deadline to 2026-11-29 makes [audit_log_export+sso_login@rush $950 2026-11-29] feasible (495_000 <= 500_000)
    const inputAfterExtend = { ...inputNov19, deadline: isoDate('2026-11-29') };
    const feasibleAfterExtend = enumerateCandidates(scopeChangePlugin, inputAfterExtend, {
      ...snapOpts,
      mode: 'feasibility',
    });
    expect(feasibleAfterExtend.items).toEqual([
      {
        optionKey: 'O1',
        candidateKey: 'audit_log_export+sso_login@rush',
        itemKeys: ['audit_log_export', 'sso_login'],
        modifiers: ['rush'],
        amountCents: cents(95_000),
        deliveryDate: isoDate('2026-11-29'),
      },
    ]);
  });

  test('14 §11 F (canary) — pure 16->12 golden table, rounds_exhausted options, and canary surface lint', () => {
    const matCanary = materializeFixture(canaryFixture, GOLDEN_ANCHOR);
    const inputCanary = toRuleInput(matCanary as unknown as Record<string, unknown>);
    const canaryDisclosures = {
      ...canaryFixture.briefs.customer.disclosures,
      ...canaryFixture.briefs.finance.disclosures,
    };

    const providerView = viewFor(scopeChangePlugin, inputCanary, canaryDisclosures, 'provider');
    expect(providerView.deadline).toBeUndefined();
    expect(providerView.capCents).toBeUndefined();
    expect(providerView.committedCents).toBeUndefined();

    // 16 candidates generated in provider view, truncated to the exact 12-row golden table (14 §11 F)
    expect(scopeChangePlugin.candidateSpace(providerView).drafts).toHaveLength(16);
    const snapR1 = enumerateCandidates(scopeChangePlugin, providerView, snapOpts);
    expect(
      snapR1.items.map((i) => ({
        optionKey: i.optionKey,
        candidateKey: i.candidateKey,
        amountCents: i.amountCents,
        deliveryDate: i.deliveryDate,
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

    // 3 provider stubDecide picks when excluding previously blocked candidates
    const excluded: string[] = [];
    const expectedBlockedAmounts = [115_000, 130_000, 140_000];
    for (let round = 1; round <= 3; round++) {
      const snap = enumerateCandidates(scopeChangePlugin, providerView, {
        ...snapOpts,
        roundNo: round,
        excludedCandidateKeys: excluded,
      });
      const dec = scopeChangePlugin.stubDecide({
        role: 'provider',
        turnKind: 'propose',
        snapshot: snap.items,
        currentProposal: null,
        ownSoft: canaryFixture.briefs.provider.softFields,
        sharedSoft: { preferredItemKeys: canaryFixture.briefs.customer.softFields.preferredItemKeys },
        allowedActions: allowedActions('provider', 'propose', snap.items.length),
      });
      const turn = dec.turn;
      expect(turn.action).toBe('propose');
      expect(turn.rationale).toContain(CANARY_RATIONALE.provider);
      if (turn.action !== 'propose') throw new Error('expected propose');

      const picked = snap.items.find((i) => i.optionKey === turn.optionKey)!;
      expect(picked.amountCents).toBe(expectedBlockedAmounts[round - 1]);
      const matPicked = scopeChangePlugin.materialize(
        { itemKeys: picked.itemKeys, modifiers: picked.modifiers },
        inputCanary.catalog,
        inputCanary.localDate,
      )!;
      const evalPicked = checkProposal(scopeChangePlugin, inputCanary, matPicked);
      expect(evalPicked.passesChecks).toBe(false);
      expect(evalPicked.blocking).toEqual(['date.after_deadline', 'budget.over']);
      excluded.push(picked.candidateKey);
    }

    // Rounds exhausted -> customer gets choose_candidate $800, $900, keep_as_is, end_run
    const exhaustedReq = buildHumanRequests(scopeChangePlugin, {
      kind: 'rounds_exhausted',
      full: inputCanary,
      viewOf: (role) => viewFor(scopeChangePlugin, inputCanary, canaryDisclosures, role),
      run: {
        excludedCandidateKeys: excluded,
        providerExcludedCandidateKeys: [],
        openRequestCount: 0,
        keepAsIsUsed: false,
        canContinue: true,
      },
      disclosures: canaryDisclosures,
    });
    expect(exhaustedReq.toRole).toBe('customer');
    expect(exhaustedReq.options.map((o) => ({ key: o.optionKey, kind: o.effect.kind, amount: o.shown.amountCents }))).toEqual([
      { key: 'A', kind: 'choose_candidate', amount: 80_000 },
      { key: 'B', kind: 'choose_candidate', amount: 90_000 },
      { key: 'C', kind: 'keep_as_is', amount: undefined },
      { key: 'D', kind: 'end_run', amount: undefined },
    ]);

    // Customer chooses opt_1 ($800) -> v1 passes at capCentsV1 (480_219 <= 512_347) and still passes at capCentsV2 (480_219 <= 481_237)
    const v1Canary = scopeChangePlugin.materialize(
      { itemKeys: ['audit_log_export', 'sso_login'], modifiers: [] },
      inputCanary.catalog,
      inputCanary.localDate,
    )!;
    expect(checkProposal(scopeChangePlugin, inputCanary, v1Canary).passesChecks).toBe(true);
    const inputCanaryV2 = {
      ...inputCanary,
      capCents: cents(canaryAmounts.capCentsV2),
      headroomCents: canaryAmounts.headroomV2Cents,
    };
    const evalCanaryV2 = checkProposal(scopeChangePlugin, inputCanaryV2, v1Canary);
    expect(evalCanaryV2.passesChecks).toBe(true);
    expect(evalCanaryV2.amounts.committedAfterCents).toBe(480_219);
    expect(canaryAmounts.capCentsV2 - evalCanaryV2.amounts.committedAfterCents!).toBe(1_018);

    // Bidirectional canary scan across provider, customer, and finance views & public texts
    const secrets = canarySecrets(matCanary.briefs.customer.hardFields.deadline);
    const providerPublicSurface: PublicText[] = [
      { label: 'provider.view', text: JSON.stringify(providerView) },
      { label: 'provider.snap', text: JSON.stringify(snapR1.items) },
      {
        label: 'provider.eval',
        text: JSON.stringify(
          projectEvaluation(evalCanaryV2, 'provider', scopeChangePlugin, canaryDisclosures),
        ),
      },
      { label: 'provider.money', text: publicMoneyText(80_000) },
    ];
    expect(lintCanaries(secrets, providerPublicSurface)).toEqual([]);

    const customerView = viewFor(scopeChangePlugin, inputCanaryV2, canaryDisclosures, 'customer');
    const customerSurface: PublicText[] = [
      { label: 'customer.view', text: JSON.stringify(customerView) },
      {
        label: 'customer.eval',
        text: JSON.stringify(
          projectEvaluation(evalCanaryV2, 'customer', scopeChangePlugin, canaryDisclosures),
        ),
      },
    ];
    const forbiddenForCustomer = secrets.filter(
      (s) => s.ownerRole !== 'customer' && !s.allowedRoles.includes('customer'),
    );
    expect(lintCanaries(forbiddenForCustomer, customerSurface)).toEqual([]);
  });

  test('14 §11 G (title_injection) — pure catalog title write gate (G1a input.invalid, G1b disclosure.blocked), untrusted_data delimiter (G2), and allowedActions check', () => {
    const spec = variantByKey('title_injection').expected;
    if (spec.kind !== 'title_injection') throw new Error('expected title_injection');
    const [attemptG1a, attemptG1b, attemptG2] = spec.attempts;

    // G1a: angle-bracket / format injection rejected with input.invalid { field: 'title' }
    const resG1a = validateCatalogRow({
      itemKey: attemptG1a.itemKey,
      kind: 'item',
      title: attemptG1a.title,
      priceCents: 30_000,
      leadDays: 14,
    });
    expect(resG1a).toEqual({
      ok: false,
      code: 'input.invalid',
      params: { field: 'title' },
    });
    expect(
      validateCatalogBatch([
        ...main.catalog.filter((r) => r.itemKey !== 'audit_log_export'),
        { ...main.catalog[1]!, title: attemptG1a.title },
      ]),
    ).toEqual({
      ok: false,
      code: 'input.invalid',
      params: { field: 'title' },
    });

    // G1b: after NFKC + stripping invisible chars, delimiter word rejected with disclosure.blocked { field: 'title' }
    const resG1b = validateCatalogRow({
      itemKey: attemptG1b.itemKey,
      kind: 'item',
      title: attemptG1b.title,
      priceCents: 30_000,
      leadDays: 14,
    });
    expect(resG1b).toEqual({
      ok: false,
      code: 'disclosure.blocked',
      params: { field: 'title' },
    });
    expect(
      validateCatalogBatch([
        ...main.catalog.filter((r) => r.itemKey !== 'audit_log_export'),
        { ...main.catalog[1]!, title: attemptG1b.title },
      ]),
    ).toEqual({
      ok: false,
      code: 'disclosure.blocked',
      params: { field: 'title' },
    });

    // G2: plain text injection accepted, delimited with canonical <untrusted_data source="provider.catalog_titles" ...>
    const resG2 = validateCatalogRow({
      itemKey: attemptG2.itemKey,
      kind: 'item',
      title: attemptG2.title,
      priceCents: 30_000,
      leadDays: 14,
    });
    expect(resG2).toEqual({ ok: true });
    const delimited = delimitCatalogTitle(attemptG2.title);
    expect(verifyUntrustedBlock(delimited, { maxChars: 80 })).toMatchObject({
      ok: true,
      source: 'provider.catalog_titles',
      decoded: attemptG2.title.replace('SYSTEM', '[removed-delimiter]'),
    });

    // Agent actions never include 'approve' or 'execute'
    for (const role of ['customer', 'provider', 'finance'] as const) {
      for (const turnKind of ['propose', 'evaluate'] as const) {
        const actions = allowedActions(role, turnKind, 2);
        expect(actions).not.toContain('approve');
        expect(actions).not.toContain('execute');
      }
    }
  });
});

describe('14 §13 convex-test walkthrough suite (wave 2)', () => {
  test.todo('T14-F03: rooms.seedDemo creates room with provenance = seeded and matches main fixture');
  test.todo('T14-G01: §10 S0–S13 full convex-test state machine walkthrough with stub mode');
  test.todo('T14-V01: Variant A (cap_4700) convex-test walkthrough with 0 model calls in Run 2');
  test.todo('T14-V02: Variant B (boundary_minus_one_cent) convex-test walkthrough');
  test.todo('T14-V03: Variant C (below_committed) convex-test walkthrough');
  test.todo('T14-V04: Variant D (required_retired) convex-test walkthrough');
  test.todo('T14-V05: Variant E (midnight) convex-test clock.rollLocalDate walkthrough');
  test.todo('T14-V06: Variant F (canary) convex-test 3-round blocked + D06 proposalId reuse walkthrough');
  test.todo('T14-V07: Variant G (title_injection) convex-test G1/G2 walkthrough');
  test.todo('T14-C01: Canary bidirectional scan across convex-test views, events, agentContext, and attempts');
  test.todo('T14-I01: Variant G2 injection resilience across convex-test agent turns');
});
