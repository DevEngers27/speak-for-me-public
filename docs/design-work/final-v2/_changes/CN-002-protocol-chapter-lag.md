# CN-002 · Protocol chapters lag the canon on human-request exits and routing

Raised by: Claude invariant check of W1-5 (claude-opus-5-5), 2026-10-24. Status: applied to 03, 04, 05, 06, 00-invariants (repo sync #53 / #54); owner accepted the proposed rulings 2026-10-24.

Rulings (canon wins; where the canon is silent, the owning chapter 05 wins):
1. **pass_to_next {toRole}** — canon D15 and 04 R21 define it (infeasible requests, fallback included, offer it to the next role in relaxationOrder by position, never to the last role, at most once per (from, to) per run; the answer re-routes with no constraints bump). 05 §5.11 and the 03 schema (`humanRequests.options[].effect`, `answer`) must add it; 00-invariants gets a matching INV (mirror of SM-31).
2. **Accepted infeasible escalation opens an `infeasible` request** addressed to the relaxation owner (05 §5.10 / §5.11.2). 06 §11.2 and INV-74 say `agent_escalated`; change them to `infeasible`. Every request's options must all be answerable; `end_run` is always present.
3. **Customer agent_escalated (needs_tradeoff) offers keep_as_is** = next round, equal to end_run when rounds are exhausted (canon D15, 05 §5.11.2, 04 R14). 06 §11.2 must drop the contrary sentence.
4. **Clarify requests end with end_run** like every other request (04 §4.8.1 H1, 04 SM-18, 06 §11.2). 05 §5.11.2 must list `end_run` for clarify.
5. **Counter feedback carries candidateKey only**; the provider's O-label is assigned when its next snapshot is built (05 §5.8.3 row 4, §5.7.2, 07 DX-11). No chapter change needed; recorded so 10-agent-runtime's `<room_state>` text is checked against it.
6. **disclose answer next step is by kind**: clarify → same_turn; infeasible fallback → re-run the S0 precheck in the same transaction (04 R20, 05 §5.11.4, canon D15). 05 §5.11.4 table should say so explicitly.
7. **rounds_exhausted carries questionKey** `request.rounds_exhausted.{rounds|no_candidates|call_limit|spend_limit}`; keep_as_is only for `rounds` (05 §5.8.5, 04 §4.8.3). 06 should reference it instead of a caller flag.
8. Naming: no `effectiveMaxRounds` (05 §5.8.1); `maxRounds` already includes the extension.

Addenda (from the re-check of the W1-5 fix, 2026-10-24):
9. 00-invariants INV-74 wording must follow rulings 2 and 5 (feedback carries candidateKey only; an accepted infeasible escalation opens an `infeasible` request). The battery title stays verbatim until the invariant text is revised, then both change together.
10. 03-schema: `humanRequests.options[].effect` (requestEffectV) must include `pass_to_next { toRole }` and `disclose { toRoles }`; the Convex validators in `convex/schema.ts` follow in the wave-2 schema task.
11. rounds_exhausted cause mapping: the provider's propose cap → `no_candidates`; `call_limit` / `spend_limit` only for the run's attempt and dollar caps (04 R6, 05 §5.8.5). keep_as_is eligibility is one predicate shared by the offer and the answer.
