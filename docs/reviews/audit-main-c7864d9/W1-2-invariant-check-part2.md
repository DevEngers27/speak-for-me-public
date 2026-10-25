# W1-2 invariant check — part 2: deviations

Severity: blocker = breaks one of the eight cores; high = a contract later tasks will copy; medium = local error; low = naming/docs. **No blocker found**: provider snapshots are never budget-filtered, raw views fail closed, optionKey never resolves outside the snapshot, and the stub cannot approve. **Two high deviations → verdict fix_first.**

## W1-2-i01 · high · two view contracts that don't agree (D10/D11, 06 §5.2, INV-09)
- Evidence: the barrel exports `viewForRole`/`normalizeEnumerationView` (candidates/view.ts:263-384) and an `enumerateCandidates` wrapper (enumerate.ts:229-293). It does not export the canonical `viewFor(p, full, disclosures, viewer)` (rules/view.ts:6-11); index.ts:20-38 exports only `materializeTerms` and `PluginContractError` from rules. The wrapper trusts only branded views (view.ts:65-71, 278). An unbranded `viewFor` output is re-projected as raw state with no `disclosures` (view.ts:349), so disclosed facts are dropped. Probe p1, main fixture: `enumerateCandidates(scPlugin, viewFor(...,'provider'))` returns **12** candidates (deadline and required items ignored), while `rules.enumerateCandidates` on the same view returns the design's **2** (T06-U18). A customer view from `viewFor` with cap+committed disclosed loses both values.
- Design ref: canon D10 `enumerateCandidates(viewFor(role))`; 06 §5.2 (one `viewFor`, driven by `p.fields`); INV-09 predicate; 07 §7.14.2.
- Fix: keep one view function. Either brand `viewFor` output, or make `viewForRole` a thin wrapper over `viewFor(plugin, full, disclosures, role)`. Accept a projected `View<RI>` without re-projecting it. Export one `enumerateCandidates` (with the 06 §10 signature) from the barrel. Add a test: `enumerateCandidates(viewFor(...))` on main gives the 2-item golden.

## W1-2-i02 · high · scope_change rules and vocabulary hard-coded in core/engine (06 R-D12/INV-R12, §12.3 B1/B5/B7, §12.4)
- Evidence: enumerate.ts:48-99 has `DEFAULT_VIEW_CHECKS`, a second copy of 14 §7 `required_offered/required_included/by_deadline`, used whenever a slice omits `checks`. Test 950 ("unified role policy … narrow slices") depends on it. Also in enumerate.ts: `DEFAULT_ROLES`/`DEFAULT_FIELDS` (33-46); a synthesized plugin with `toRuleInput` pinned to `2026-11-02`, `hardProjection: () => ''` and a stub that always returns O1 (133-198). types.ts:31-34 duplicates `ScopeChangeRuleInput`, and types.ts:114-179 defines `Provider/Customer/FinanceEnumerationView` with fixed fields. view.ts:391-498 defines `ScopeChangeFixtureLike`/`viewForRoleFromFixture`, and view.ts:53 defaults `assigneeRole` to 'provider'. Another scenario passed as a slice would silently get scope_change checks.
- Design ref: 06 §12.3 (the engine must not know role names, field meanings or checks), §12.4 (one scope_change implementation), R-D12/INV-R12 lint, canon §1.6 (`hardProjection` is a plugin member).
- Fix: require a full `ScenarioPlugin` (or a slice that must carry `roles/fields/checks`) and throw when it is missing. Delete the DEFAULT_* constants and the fake plugin. Move the fixture helper and `ScopeChangeRuleInput` to `core/scenarios/scope-change`. Derive view fields from `plugin.fields`, as `viewFor` already does.

## W1-2-i03 · medium · anchor and finance-empty rules depend on defaults and overrides (D10, 06 §10.1 r3, 05 §5.7.2)
- Evidence: enumerate.ts:271-280 defaults `roundNo` to 1 and a provider's `turnKind` to 'propose'. A round-2 call that omits `roundNo` still anchors (probe p3). An explicit `anchor: true` is honoured for customer evaluate (probe p3). The finance n=0 rule (enumerate.ts:241) checks the raw `opts.turnKind`, so finance without `turnKind` gets 2 candidates (probe p2).
- Fix: make `turnKind` and `roundNo` required. Compute `anchor = role === proposerRole && turnKind === 'propose' && roundNo === 1` and drop the override. Return [] for any non-counter evaluator by `turnKind`.

## W1-2-i04 · medium · `allowedActions` overload means two different n (INV-22, 05 §5.3.3 / §5.7.2)
- Evidence: resolve.ts:166-171. A number is treated as a total that includes the base (`1` → no counter). An array is treated as a base-excluded pool (one item → counter kept; probe p11). Passing `snapshot.length` of an evaluate snapshot therefore drops a legal counter. The canon function also lives in candidates/resolve.ts rather than `core/engine/protocol/allowedActions.ts`.
- Fix: keep the single signature `allowedActions(role, turnKind, snapshot)` (snapshot already excludes the base, so counter needs n ≥ 1, per 05 §5.7.2). Remove the numeric form and move the function to protocol/.

## W1-2-i05 · medium · stub and snapshot results are hybrid objects (D26, INV-66, 06 §12.1 m13)
- Evidence: stub.ts:6-17 `wrapStubDecision` adds non-enumerable `action/optionKey/rationale` to the `{turn}` root (types.ts:328). Probe p5: `'action' in res === true`, own properties `[turn, action, optionKey, rationale]`. enumerate.ts:119-131 hangs non-enumerable `items/materialized/emptyReasons` on the snapshot array. A parsed live response lacks these properties, so code that reads `res.action` works with the stub and breaks with live.
- Fix: return the plain `{ turn }` (the scenario member returns `AgentModelOutputRoot`). Return `{ items, materialized, emptyReasons }` as in 06 §10.

## W1-2-i06 · low · branded-type casts and fabricated defaults in view normalisation (INV-43, INV-78, INV-62)
- Evidence: view.ts:26-34 and 46 cast invalid values into `Cents`/`IsoDate`. Probe: deadline `2026-02-30` passes view construction and later throws `check_failed`; a NaN cap silently empties the finance snapshot. view.ts:49 defaults a missing `provenance` to 'seeded'. The engine README says untrusted values go through constructors, never casts.
- Fix: validate with `cents()`/`isoDate()` and throw `input.invalid`/`internal`. Require `provenance` and do not default it.

## W1-2-i07 · low · aliases and duplicate names (canon §1.6)
- Evidence: one function under several names: `viewForRole` = `buildRoleEnumerationView`, `resolveOptionKeyResult` = `resolveOptionKeyWithReason`. Option aliases `round`/`roundNo`, `exclude`/`blockedCandidateKeys`/`excludedCandidateKeys`, `baseProposal`/`baseCandidateKey`. Same name, different signature: `stubDecide`, `materializeCandidate`, `enumerateCandidates` (engine vs scenario vs rules). scope-change/index.ts:29-34 re-exports engine functions. `preferredDate` appears in `RoleDisclosures`/softFields, but 14 §4 / §15.8 and 07 §7.8.4 removed it; the CE-006 battery text still mentions it, so the design is inconsistent here too.
- Fix: one canonical name per function and one option name per concept (`excludedCandidateKeys`, `roundNo`). Remove `preferredDate`.

## W1-2-i08 · low · `lines` order differs from 14 §6.2
- Evidence: `scopeChangeMaterialize` → rules/materialize.ts:40 orders items then modifiers (probe p12 `[audit_log_export, sso_login, rush]`). 14 §6.2 sorts all rows by itemKey (`audit_log_export, rush, sso_login`). This affects stored `lines`/`plannedTasks` order and any goldens.
- Fix: sort rows by itemKey in `materializeTerms` (W1-1 code), or in the scenario before delegating.

## W1-2-i09 · low · the system view can produce a turn snapshot (06 §10.1 rule 1)
- Evidence: view.ts:113-136. A raw input with `viewer: 'system'` in snapshot mode returns a budget-filtered snapshot labelled O1 (probe p10). Nothing stops a caller from persisting it as a provider turn snapshot.
- Fix: throw when the role is `system` and the mode is `snapshot`. Allow `system` in feasibility mode only.

## W1-2-i10 · low · CE-078 test locks a construction that contradicts the set definitions
- Evidence: battery 04:60-77 puts the base key into `excludedCandidateKeys` and asserts `action.repeats_blocked`. Per 05 §5.6.2/§5.7.2, the run set never contains the base; countering with the base in loose mode is `action.option_not_in_snapshot`.
- Fix: assert `option_not_in_snapshot` against the base-excluded snapshot only, and drop the injected-base assertion.

## Notes
- Design inconsistencies seen: canon D21 puts `enumerateCandidates`/`buildHumanRequests` in core/scenarios/scope-change, while canon §1.6 and 06 §10/§12.3 put them in the engine. INV-22 "n<2" vs 05 §5.7.2 "≡ n<1" vs T14-R04 "n=1 no counter". CE-006 still uses `preferredDate`. D10/D11 are in 00-canon-part2.md, not part3; part3 D12 covers the fit/oracle policy.
- W1-1 (not W1-2): `rules.enumerateCandidates` rejects `limit: Infinity` even in feasibility mode, but the 14 §6.4 `relaxations` call it that way. W1-2 works around this by passing 12, which feasibility mode ignores.
- Plugin registration with real hooks remains W1-3 (review r01).
