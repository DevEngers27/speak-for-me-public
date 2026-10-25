# W1-2 invariant / canon check (read-only)

Worktree `/Users/zhennn/speak-for-me-wt/W1-2` @ f7fe95a (wave1/W1-2), diff vs origin/main on core/ and tests/. Design: final-v2 as read at 14:4x (00-invariants parts 2/3/5/7 and canon were being edited; nothing looked half-written). Verified in a cloned scratch copy (`scratchpad/w12probe`): W1-2 tests 39 pass / 24 todo, whole `core` project 386 pass, `tsc` (root + tests) and `eslint core tests/...` clean. Probes p1–p12 + D3/E3 run in the copy only.
Deviations: see `W1-2-invariant-check-part2.md`.

Selected ids: INV-01 02 03 04 05 07 08 09 10 19 22 23 30 36 37 38 39 41 43 45 55 62 64 66 74 77 78; INV-R6 R9 R12, T06-P6/P7; INV-S1 S6; CE-003 005 006 014 039 040 078 079 087 088 091 165 167; 14 §6.1/6.2/6.3, §11 A/D/E/F; canon D10 (a–g), D11, D12④, D13, D26, §1.2, §1.6; 05 §5.3.3, §5.7.2, §5.7.3; 06 §5.2, §10.1; CN-002 #5.

| id | status | code location | note |
|---|---|---|---|
| INV-01 | satisfied | candidates/view.ts:105-252 | raw views built through W1-4 projectForRole (budget, briefs); test "enforces what each role may see…" |
| INV-02 | satisfied | view.ts:204-216, 219-238 | provider budget hard-undefined; tests "enforces what each role may see…", "strips budget fields from provider view…" |
| INV-03 | satisfied (enum part) | rules/candidates.ts:27 | snapshot = 6 public fields only; context assembly is later work |
| INV-04 | not_implemented_yet | — | strict schema/whitelist not in scope; stub object shape see i05 |
| INV-05 | satisfied | rules/candidates.ts:27; scope-change/candidates.ts:226-288 | no titles/free text in snapshot; fixed English rationales |
| INV-07 | satisfied | rules/types.ts:19-20 | no deferred* in snapshot/Materialized |
| INV-08 | satisfied | view.ts:139-160 | tests "fails closed when disclosures are omitted…", battery CE-006; probe p9 (cap 4,000→90,000 byte-identical) |
| INV-09 | satisfied* | enumerate.ts:229-293 → rules/candidates.ts:12-41 | battery INV-09 (01:140), unit 203/353; *only with viewForRole input — canonical viewFor input breaks it (i01) |
| INV-10 | not_implemented_yet | rules/humanRequests.ts (W1-1) | not wired by W1-2; second view fn is a divergence risk (i01) |
| INV-19 | satisfied | view.ts:80-93, 188-202 | finance sees required/deadline only if disclosed; r02 test loops finance |
| INV-22 | satisfied | resolve.ts:157-185 | battery INV-22 (02:57); overload ambiguity → i04 |
| INV-23 | satisfied (optionKey part) | resolve.ts:47-87 | "resolves valid optionKeys strictly within the snapshot…"; version/topic refs pending |
| INV-30 | satisfied (enum part) | enumerate.ts:245-249 | rejected/blocked keys removed when passed; excludedCandidateKeys(run) derivation later |
| INV-36 | satisfied | resolve.ts:112-146 | "materializes a resolved option on a rolled localDate…" (11-16→11-17) |
| INV-37 | satisfied | rules/materialize.ts:30-52 (reused); resolve.ts:123-139 | rush = catalog modifier row; Σ lines; line order → i08 |
| INV-38 | satisfied | scope-change/candidates.ts:92-95 | "returns empty snapshot with item.required_missing without throwing…" |
| INV-39 | satisfied | rules/budget.ts:14 (reused) | walkthrough: 480000 passes, $900 over by 10000 |
| INV-41 | satisfied (pure) | resolve.ts:70-147 | battery CE-078/CE-088; turns.complete not in scope |
| INV-43 | deviates (low) | view.ts:26-34, 46 | casts instead of constructors → i06 |
| INV-45 | satisfied | scope-change/candidates.ts | pure; lint clean |
| INV-55 | not_implemented_yet | — | insertProposal/versioning later |
| INV-62 | deviates (low) | view.ts:49 | missing provenance defaulted to 'seeded' → i06 |
| INV-64 | not_implemented_yet | rules/humanRequests.ts | per-view emptiness correct (finance @470000 → []), wiring later |
| INV-66 | deviates (medium) | stub.ts:6-17 | hybrid result object → i05; AgentDriver later |
| INV-74 | not_implemented_yet | — | resolveRound later; walkthrough shows blocked→excluded→round 2 |
| INV-77 | satisfied | enumerate/view | no clock; localDate is input |
| INV-78 | satisfied | scope-change/candidates.ts:115,169 | string compare; `<=` deadline, `>` for rush |
| INV-R6 | satisfied | scope-change/candidates.ts:116-118; rules/materialize.ts:45 | ≤1 modifier; overflow → null |
| INV-R9 | satisfied | rules/candidates.ts:24 | items pass checkProposal(view) |
| INV-R12 | deviates (high) | enumerate.ts:33-99,133-198; types.ts:31-34,114-179; view.ts:391-498 | scenario rules/fields/roles in engine → i02 |
| T06-P6/P7 | not_implemented_yet | — | example tests only, no ≥2,000-case property tests |
| INV-S1 | satisfied | scope-change/candidates.ts:115 | tests 392/409 |
| INV-S6 | satisfied | view.ts:204-216 | test 177 |
| CE-003 | satisfied | rules/types.ts:19-20 | structural |
| CE-005 | satisfied | view.ts:204-216 | test 177, battery INV-09, probe p9 |
| CE-006 | satisfied | view.ts:139-202 | battery CE-006 (01:144) |
| CE-014 | satisfied (pure) | scope-change/candidates.ts:83-90 | confirmed-only |
| CE-039 | not_implemented_yet | — | output rejection boundary absent |
| CE-040 | satisfied (optionKey half) | resolve.ts:76-78 | baseProposalVersion half pending |
| CE-078 | satisfied | enumerate.ts:251-261 | battery 04:41; one assertion contradicts design → i10 |
| CE-079 | satisfied (pure) | resolve.ts:166-181 | n<2 drops counter |
| CE-087 | satisfied (enum) | scope-change/candidates.ts:93-95 | no throw |
| CE-088 | satisfied | resolve.ts:79-80 | battery 04:82 |
| CE-091 | satisfied | rules/materialize.ts:35-40 | modifier resolved by kind |
| CE-165 (S7–S8) | satisfied | — | test "walks through S7–S8…" ($900 blocked, $800 = cap) |
| CE-167 / 14 §11 A | satisfied (pure) | — | finance @470000 → [] (test 320); customer cap-only → 2 (probe p8) |
| 14 §11 D | satisfied | — | D2 test 438; D3 probe = [sso_login 50000 11-13, +usage 60000 11-18] (untested) |
| 14 §11 E | satisfied | — | E1 test 701; E3 probe = [audit+sso@rush 95000 11-29] (untested) |
| 14 §11 F | satisfied | — | 16→12 golden exact (test 353) |
| 14 §6.1 S-D3 | satisfied | scope-change/candidates.ts:76-123 | tests 392/409 |
| 14 §6.2 | deviates (low) | rules/materialize.ts:40 | lines items-then-modifiers, not itemKey order → i08 |
| 14 §6.3 stub | satisfied | scope-change/candidates.ts:209-290 | tests 739 (50× determinism), 803, 450 |
| D10a optionKey only, server terms | satisfied | resolve.ts:98-147 | claim check vs snapshot |
| D10b ≤12, candidateKey order | satisfied | rules/candidates.ts:13,26,39 | test 353 |
| D10c provider not budget-filtered | satisfied | view.ts:204-216, 285-296 | test 177 |
| D10d blocked removed in run | satisfied | enumerate.ts:245-249 | walkthrough test |
| D10e round-1 anchor | deviates (medium) | enumerate.ts:240-280 | algorithm right (test 245); defaults/override wrong → i03 |
| D10f item shape = candidateV | satisfied | rules/types.ts:20; convex/schema.ts:33 | exact 6 fields |
| D10g resolve inside snapshot | satisfied | resolve.ts:47-63 | never re-enumerates |
| D11 fail-closed views | satisfied | view.ts:80-93, 349 | test 81 (r02) |
| D11 / 06 §5.2 single viewFor | deviates (high) | view.ts:263-384; index.ts:20-38 | → i01 |
| D12④ derived budget | satisfied | disclosure hasField via view.ts:156 | probe p8: headroom only when cap+committed disclosed |
| D13 | satisfied | — | no public text produced |
| D26 stub = model schema | deviates (medium) | stub.ts:6-17 | → i05 |
| §1.2 candidateKey/optionKey | satisfied | keys.ts:15-25; resolve.ts:15 | O1..O12 |
| §1.6 one name per function | deviates (low) | index.ts:20-38; scope-change/index.ts:12-34 | → i07 |
| 05 §5.3.3 allowedActions | deviates (medium) | resolve.ts:157-185 | → i04 |
| 05 §5.7.2 customer excl. base+run | satisfied | enumerate.ts:251-261 | test 293 |
| 05 §5.7.2 finance n=0 | deviates (medium) | enumerate.ts:241 | only if turnKind passed (probe p2) → i03 |
| 05 §5.7.3 claim assert | satisfied | resolve.ts:123-139 | |
| 06 §10.1 r1 system ≠ snapshot | deviates (low) | view.ts:113-136 | → i09 |
| CN-002 #5 | satisfied | enumerate.ts:264-269 | counter forwarded by candidateKey, relabelled (probe p6) |

Counts (72 rows): satisfied 53 (INV-09 counted satisfied with caveat), deviates 12, not_implemented_yet 7, unverifiable 0. Deviation rows map to 10 deviations (i01–i10).
