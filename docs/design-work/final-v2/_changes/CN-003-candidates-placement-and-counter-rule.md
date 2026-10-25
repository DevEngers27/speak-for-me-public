# CN-003 · Candidate enumeration placement, counter rule, preferredDate, feasibility limit

Raised by: Claude invariant check of W1-2 (claude-opus-5-5), 2026-10-24. Status: applied (repo sync #53 / #54); owner accepted the proposed rulings 2026-10-24.

1. **Placement of enumerateCandidates**: canon D21 places it in scenarios, while canon §1.6 and 06 §10 place it in the engine (the scenario supplies candidateSpace drafts / materialize / stub only). Ruling: engine (§1.6 and 06 win; D21's wording is corrected). One `enumerateCandidates` with the 06 §10 signature; the scenario never re-implements enumeration.
2. **Counter rule**: INV-22 says a counter is allowed when the base-excluded snapshot has n ≥ 2 (n < 2 drops counter); 05 §5.7.2 reads as n ≥ 1; T14-R04 differs again. Ruling: the snapshot handed to `allowedActions(role, turnKind, snapshot)` already excludes the base; counter is allowed when n ≥ 1. INV-22 and T14-R04 wording to match 05 §5.7.2.
3. **preferredDate**: v1 removed it (14 §4, 07 §7.8.4); CE-006 still names it. CE-006 text must use preferredItemKeys / undisclosed requiredItemKeys.
4. **Feasibility limit**: 14 §6.4 relaxations call `enumerateCandidates` with `limit: Infinity` in feasibility mode; 06 §10 should state that feasibility mode has no limit (W1-1 code rejects Infinity today → W1-1 follow-up).
5. **One view function**: `viewFor(plugin, full, disclosures, role)` (06 §5.2) is the only way to build a role view; any helper is a thin wrapper that returns the same branded `View<RI>`; `enumerateCandidates(viewFor(role))` must give the 06 goldens.
