# W1-5 invariant / canon check (resolveRound, buildHumanRequests)

Branch `wave1/W1-5` @ 482b0b0, diff = `git diff origin/main...HEAD` (10 files). Read-only. Probes: modules compiled with tsc into scratchpad `w15build/`, run by `w15probe/probe1.cjs` and `probe2.cjs`. No repo file touched.

Design read: 00-invariants + part2..11, canon §1, D08, D11 (part2), D12, D15 (part3), C54 (part5), 05-protocol all parts, 04 part2 (R1-R21) and part4 §4.8, 06 part7 §11, 07 part4 DX-11, `_changes/CN-001` (gateway, not relevant).

Design consistency notes (not half-edited, but behind the canon):
- Canon D15 (revised 2026-10-24) adds `pass_to_next`; 04 R21/§4.8.2-3/SM-31 follow it. 05 §5.11.1/§5.20 ("nine effects incl. `blocked`") and the repo's 03 `requestEffectV` do not.
- Customer `agent_escalated` keep_as_is: canon D15, 05 §5.11.2 and 04 R14 offer it; 06 §11.2 says no.
- Clarify request without `end_run` (05 §5.11.2) vs 04 H1 guard, 04 SM-18 and 06 §11.2 ("always contains end_run").
- Kind of an accepted `escalate(infeasible)`: `infeasible` (05 §5.10/§5.11.2) vs `agent_escalated` (06 §11.2, INV-74).
- CE-167 ($4,700 asks customer first) contradicts D15 and 05 §5.15 (customer skipped, finance gets raise_cap).

Selected ids:
- INV-06, 08, 09, 10, 11, 22, 23, 30, 32(c), 34, 35, 41, 64, 65, 68, 72, 73, 74, 76, 78
- CE-007, 009, 080, 087, 092, 167
- 05 INV-P7, P10, P11; 07 DX-11
- canon §1.3 (`passesChecks` name), §1.6 (one `buildHumanRequests`); D08, D11, D12⑤, D15 (kinds, effects, exits, one open, relaxationOrder, rounds_exhausted, agent_failed, TTL, no close)
- 04 R5, R6, R14, R15/R19, R20, R21, H1

Paths: `rr` = core/engine/protocol/resolveRound.ts, `hr` = core/engine/protocol/humanRequests.ts, `disc` = core/engine/disclosure/index.ts, `rev` = tests/engine/protocol.review.test.ts, `pt` = tests/engine/protocol.test.ts, `pc` = tests/engine/protocolChecks.ts.

| id | status | location | note / test |
|---|---|---|---|
| INV-06 | satisfied | rr:25,41,56 | Blocked feedback is only `{fit:'blocked'}` (no code, no checkId); rev "S1 blocked proposals skip evaluation" |
| INV-08 (requests) | satisfied | pc:47-48 | Canary: finance private change leaves the customer request byte-identical; pt "generates one request using only the target view". Probe: the finance request does not change when the customer's private requiredItemKeys change |
| INV-09 | not_implemented_yet | - | Snapshot creation is a later task; the builder uses feasibility enumeration (≤12, excluded keys) |
| INV-10 / D11 | satisfied | hr:107-113; disc:214,253-272 | Options are built from `viewForRole(toRole)` (viewer check hr:37), projected, then `assertOptionsProjected`. raise_cap only goes to finance (disc:215). Battery 01 INV-10 and the pc:49-50 "Shown option unavailable" canary. Nothing is written as `blocked` (no number leaks) |
| INV-11 / D12⑤ | satisfied | rr:36-38,57 | Provider count ≥4 gives exhausted; a 5th customer counter is ignored; pc:24-25. Customer count = 4 (still forwarded) is untested |
| INV-22 | satisfied | rr:57 | A counter from a role outside `counterRoles` counts as not_accepted (probe only; no test). `allowedActions` is a later task |
| INV-23 | not_implemented_yet | - | `validateMoveSemantics` is later (see i07 for the lenient version) |
| INV-30 | not_implemented_yet | - | Agent reject goes to next round (D08 row 5 test); the human reject path (R10/R11) is later |
| INV-32(c) | not_implemented_yet | hr:49-76 | Infeasible builder is ready; bump/react is later |
| INV-34 / D15 one open | satisfied | hr:29 | pc:44 `human_request_already_open`. Persistence guard (`by_run_status`) is later; the rules wrapper hardcodes 0 (i09) |
| INV-35 / canon §1.3 | satisfied | rr:13,56 | Uses `passesChecks`; currency checks belong to the caller |
| INV-41 | not_implemented_yet | - | `turns.complete` |
| INV-64 | satisfied | hr:28-115 | One draft; options are effects; relaxationOrder; pt "uses customer relaxations when required scope cannot fit", pc:33-36 |
| INV-65 | satisfied (pure) | hr:99,125,134 | keep_as_is once, and equal to end_run when exhausted (rev "answer effects cover…"); no close option (pc:51). TTL expiry is later |
| INV-68 | satisfied (pure) | rr:43 | Order prefix, no move after a short circuit, no extras: rev "S2 rejects evaluations after a human short circuit". Battery INV-68 still todo (needs CT) |
| INV-72 | deviates | rr:31,38 | Cause / questionKey lost (i06) |
| INV-73 | deviates | hr:117-136 | i01, i02, i04, i05 |
| INV-74 | satisfied | rr:41-58 | Literal priority order holds: rev "D08 row 1"…"row 5", pc checkRoundTable. Battery INV-74 still `it.todo` (i11). See i03 and i07 |
| INV-76 / R17 | satisfied | hr:125 | end_run gives ended_no_agreement; rev "answer effects cover…" |
| INV-78 | not_implemented_yet | - | Date window is checked at answer time |
| CE-007 | satisfied | hr:58-60 | Probe: raise_cap is 480000 with or without disclosure and comes from the finance view. No repo test covers the undisclosed variant |
| CE-009 | satisfied | rr:38 | pc:24 |
| CE-080 | satisfied | rr:38 | pc:21; questionKey see i06 |
| CE-087 | satisfied | hr:54-71 | pt "uses customer relaxations…" |
| CE-092 | satisfied | rr:41 | rev "S1 blocked…" |
| CE-167 | satisfied (per canon) | hr:56 | Customer skipped, finance raise_cap (pc:35-36); the CE text conflicts with D15 |
| INV-P7 | not_implemented_yet | - | convex-test afterEach |
| INV-P10 | satisfied | disc:253-272 | pc "Shown option unavailable" |
| INV-P11 | satisfied | rr:25 | Provider gets ok/blocked only |
| DX-11 / 05 §5.8.3 row 4 | deviates | rr:6,25,58 | Customer's own O-label is forwarded (i03) |
| D08 serial + table | satisfied | rr:41-58 | rev rows 1-5, S1, S2 |
| 05 §5.8.1 naming | deviates | rr:18 | `effectiveMaxRounds` (i10) |
| D15 kinds | satisfied | rules/types.ts:21 | Five kinds |
| D15 effects | deviates | rules/types.ts:22; hr:50-76,117 | No `pass_to_next` (i02) |
| D15 exits | deviates | hr:99,117-136 | i01, i04, i05 |
| D15 relaxationOrder + fallback | satisfied | hr:49-76 | pc:33-36 ($4,700 gives finance 480000; $4,799.99 by probe); rules/review.test.ts "falls back to disclosure…" |
| D15 rounds_exhausted | deviates | hr:86-99; rr:31 | Options right (choose ≤3 / keep once / end_run, pc:37-43); questionKey missing (i06) |
| D15 agent_failed | satisfied | hr:82-84 | pc:45-46 |
| D15 TTL | not_implemented_yet | hr:9 | Constant = 7; expiresAt/expireDue are later; no test |
| 04 R5 | deviates | rr:4,56 | Version not bound (i07) |
| 04 R6 | satisfied | rr:38 | Rounds, propose cap, no candidates all exhaust (i06 on cause) |
| 04 R14 | deviates | hr:99 | i05 |
| 04 R15/R19 | satisfied | hr:121 | `recheck_candidate`; regenerate is persistence's job |
| 04 R20 | deviates | hr:122,132 | i04 |
| 04 R21 | deviates | - | i02 |
| 04 H1 | deviates | hr:103 | Clarify has no end_run (i08); one open and projection OK |
| canon §1.6 | deviates | core/engine/rules/humanRequests.ts:7-20 | Two `buildHumanRequests` (i09) |

Counts (47 rows): satisfied 26, deviates 13, not_implemented_yet 8, unverifiable 0.

Verdict: **fix_first** (4 high: i01-i04). Details in `W1-5-invariant-check-part2.md`.
