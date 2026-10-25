# Authoritative product requirements audit

Audit date: October 25, 2026, America/Los_Angeles. Source baseline: `DevEngers27/speak-for-me` main at `df738c6`, followed by the team's PR 101 fixes. The original source inspection is supplemented below with actual release probe evidence. Undemonstrated requirements remain incomplete.

## Current evidence update

Actual Convex release probes ran on `benevolent-jackal-41` using synthetic identities through administrator impersonation. Seven completed `claude-opus-5-5` calls produced the $900 proposal and $800 alternative. The autonomous run reached `needs_input` / `rounds_exhausted`; its [smoke record](../../probe-results/2026-10-25-release-live-smoke.json) intentionally remains failed rather than inventing agreement. A [subsequent explicit Customer choice](../../probe-results/2026-10-25-release-human-recovery.json) selected the existing $800 proposal, followed by three fresh approvals and atomic final-vote execution. That probe reports one execution, ledger commitment, change order and execution event; two tasks; duplicate-final-approval idempotency; zero invariant findings; passing projected privacy; and an idempotent follow-up that still requires Finance baseline confirmation.

Latest full CI at `97c1417` reports 2,154 tests passed, 39 TODO tests and seven skipped files; lint, types, boundaries, policy and both builds passed (see VALIDATION.md). The full three-account browser workflow remains unverified; the working sign-in route requires no new Google configuration from the user. The corrected canonical-component SPA is deployed at [the product URL](https://speak-for-me-calhacks.lgc783656618.chatgpt.site); homepage, room sign-in gate and Clerk sign-in rendering were observed. The owner authorized public website access at 14:35:34 UTC. One real Google-via-Clerk account also saved and reloaded a Provider private brief. The completed 177.0-second video passed decode/subtitle and 12-scene visual review; the 7-page PDF is ready. The video is illustrative, not a live authenticated cloud recording. See [PRODUCT_REPORT.md](PRODUCT_REPORT.md) for exact metrics and evidence boundaries. These updates supersede the source-only status of corresponding rows below; they do not turn every untested gate into a pass.

## Correct baseline and delivery scope

The earlier `cal-hack-2026` demonstration was the wrong product baseline for this release. Preserve its history as history; do not carry over its domain engine, shared-budget projection, quote fixture, private chat persistence, or separate Finance execution action. The authoritative implementation is this repository and its `docs/design-work/final-v2` design. Preserve the existing core, normalized Convex schema, functions, generated API, routes, UI contracts, tests, and teammate authorship.

The owner has cloud services and requires the actual connected product. A credential-free local adapter is not a current requirement and must not be built as a substitute. The integration lead has provisioned the isolated real-team Convex backend `benevolent-jackal-41`; this configuration fact does not by itself prove the connected workflow passed. Preserve `/rooms` authentication, existing generated API wiring, `final_product` history, and team main ancestry. Complete missing functional editors, the accepted visual improvements, actual cloud verification, and a new accurate video/report.

The inherited README called the project a skeleton despite substantial business functions and wired UI. The release README now replaces that stale label with measured results and pending gates. `docs/PROCESS.md` remains a dated development snapshot, not an inventory of today's missing code.

## Requirement authority

Use `docs/PROCESS.md` for design precedence: canon and its rulings first, then owning chapters, invariant definitions, and executable battery. Change notices amend their referenced text subject to canon. This audit uses the current `final-v2` product scope, frontend contracts, testing boundaries, and the implemented scenario fixture.

Principal references:

- `docs/design-work/final-v2/00-canon-part2.md` through `00-canon-part4.md`: approval/execution, privacy, terminal room, v1 scope, and fixture decisions.
- `docs/design-work/final-v2/01-product.md` §1.2–1.6: roles, scope, model boundaries, first-class no-agreement outcomes.
- `docs/design-work/final-v2/01-product-part3.md`: Finance budget-cut and final-approval journey.
- `docs/design-work/final-v2/01-product-part4.md`: recovery, actor-specific requests, fixture provenance, and traceability.
- `docs/design-work/final-v2/13-frontend.md` and parts 2–6: decision inbox, projections, routes, decision panels, and accessibility.
- `docs/design-work/final-v2/16-testing.md`: static/L0/L1/L2/L3/L4 evidence boundaries.
- `docs/design-work/final-v2/17-roadmap.md`: future work; not an instruction to implement every extension now.

## Semantic corrections from the previous demonstration

| Topic | Authoritative requirement | Release consequence |
| --- | --- | --- |
| Financial privacy | Provider never receives cap, committed amount, headroom, or private budget-derived checks. Customer sees only explicitly disclosed fields and permitted derivations. | Project before data reaches a browser, export, event text, or agent context. Hiding a widget is insufficient. |
| Default disclosure | Finance shares no budget fields by default; the main fixture explicitly shares only cap with Customer. | Customer may know the cap while still lacking the existing commitment and headroom. A provider must not infer the reason for a blocked option from rendered details. |
| Approval identity | Exact immutable proposal, current constraint version, `termsKey`, current individual membership, and distinct people. | Do not replace with a role-only approval set from the former demo. |
| Execution | The last required human approval executes in the same transaction. | Explain the effect on that approval control. There is no separate Finance “Execute change order” step. |
| Seeded negotiation | Item catalog and deterministic candidate materialization, not three opaque all-in quotes. | Preserve line snapshots, revisions, exact sums, delivery dates, and source references. |
| Fixture | $4,000 baseline + $900 phase; cap $5,000 → $4,800; revised required-only proposal $800. | Final commitment is $4,800, exactly the cap. Do not reuse the former $700 recovery or Invoice export/Status tracking features. |
| Inputs | Structured private brief and catalog forms in v1; explicit per-field disclosure. | Do not make conversational extraction or a persistent chat box the primary product. They are explicitly deferred. |
| Agent communication | Isolated participant contexts; fixed public reason/topic templates; rationale private to the owner. | Avoid a fabricated public conversation stream containing all parties' thoughts. Finance agent advises; code does arithmetic. |
| Main navigation | Decision inbox → role-projected room → precise decision/request → result/timeline. | Preserve the existing routes and view models. The first screen answers who needs to do what. |
| No agreement | Normal outcome, with a specific next actor and safe exits. | Demonstrate infeasibility and human tradeoffs, not only the happy path. |
| Completed room | Terminal; subsequent changes use a new follow-up room. | Do not reopen an executed negotiation or mutate approved terms. |
| Operational controls | Production routes do not expose reset, seed, or “Preview as”. | Use authorized development tooling for synthetic fixture preparation; do not add presentation bypasses to product routes. |

## Requirement matrix

Status **source present** means code was located, not runtime acceptance. **Release gap** means a gap in the connected deliverable. **Unverified** requires fresh executable evidence. Paths below are evidence locations, not assertions that every branch is correct. Main plus the team's PR 101 fixes are now included; the baseline inspection predates subsequent in-progress UI fixes.

| Priority / requirement | Design anchor | Main source evidence | Status and remaining acceptance |
| --- | --- | --- | --- |
| P0 authoritative foundation | D21; README principles | `core/engine/`, `core/scenarios/scope-change/`, `convex/schema.ts`, `scripts/check-boundaries.mjs` | Source present. Preserve layer/purity checks and generated types; run existing checks. |
| P0 actual connected presentation | Owner's corrected cloud delivery scope | `src/proxy.ts`; `src/components/providers.tsx`; `cloud/`; generated API wiring | Backend actual write/read probes passed scoped checks. Corrected frontend deployment succeeded; three real sessions and authenticated live browser updates remain pending. Missing-key redirection is correct behavior. |
| P0 real production path retained | 12 API; 13 FE-D13/14 | `src/components/inbox/InboxScreen.tsx`, `src/components/room/RoomFrame.tsx`, `RoomScreens.tsx` | Source present: UI calls generated Convex APIs. Do not replace with a static mock. Real configured environment unverified. |
| P0 decision inbox | D19; 13 §13.3 | `src/components/inbox/DecisionInbox.tsx`, `InboxScreen.tsx` | Source present. Verify four decision groups, actor-specific CTA, empty/error/loading states. `listMine` first page is queried; full pagination behavior needs review against the design. |
| P0 creation, seats, invitations | D24; 01 S0 | `convex/rooms.ts`, `convex/invites.ts`, `src/components/room/NewRoomScreen.tsx`, People screen | Source present. One actual Google-via-Clerk account was verified; cross-account invitation acceptance remains unverified. Local demo seats must not be advertised as real authentication. |
| P0 private structured briefs | 01 §1.2/1.3; D13 | `convex/briefs.ts`, `convex/sharedFacts.ts`, `RoomScreens.tsx`, `RoomSections.tsx` | Source present. Verify draft changes do not persist before confirmation, disclosure mirrors match recipients, notes stay private. |
| P0 confirmed catalog and baseline | D23/D25/D27 | `convex/catalog.ts`, `convex/ledger.ts`, `convex/budget.ts`, scenario fixture | Source present. Verify source revision validation, exact integer cents, baseline only during setup, cap cannot fall below committed total. |
| P0 least-disclosure projection | D11/D12; 07; 13 FE-D03/16 | `core/engine/projection.ts`, `core/engine/disclosure/`, `convex/model/`, `src/lib/viewModels/types.ts` | Source present. Scan actual role payloads and visible text, including errors, timeline, results, and model context. No private-budget leakage to Provider. |
| P0 deterministic eligibility | Core principle 4; 06 | `core/engine/rules/`, `core/engine/candidates/`, `core/scenarios/scope-change/` | Source present. Verify budget, required items, deadline, source revisions, and materialized amounts/dates on canonical fixture. |
| P0 isolated bounded agents | D08/D09/D26; 10 | `convex/runs.ts`, `convex/turns.ts`, `convex/model/agents/`; release public trace | Seven real Claude calls completed. Autonomous negotiation stopped for human input; do not claim autonomous agreement. Full isolated-context browser/model inspection remains distinct. |
| P0 budget-cut invalidation | D05/D06; 09; 01 F5 | Release smoke/recovery JSON; existing constraint functions | Real probe: cap 500000 → 480000; constraint version 2; two old approvals stale; replay rejected. Real Clerk UI confirmation path still pending. |
| P0 exact human decisions | D02/D25; 08 | `convex/approvals.ts`, `core/engine/rules/approvals.ts`, Proposal screen | Source present. Verify expected constraint version and terms key, reject, withdraw, and distinct current members. |
| P0 atomic final approval | D02/D03; 08 | `convex/approvals.ts`; release human-recovery JSON | Actual deployed recovery reports one outcome, duplicate-final-approval idempotency and zero invariant findings. Scope is the recorded probe, not every OCC counterexample. |
| P0 internal outcome | Core principles 5–7 | `convex/executions.ts`, `convex/tasks.ts`, Results screen | Source present. Show change order, ledger commitment, snapshot-backed tasks, authorized task completion; no external payment/signature. |
| P0 safe infeasibility | D15; 01 §1.6, X6 | `convex/humanRequests.ts`, `core/engine/rules/humanRequests.ts`, request screen | Deployed $4,700 case passed: Finance request, Provider generic waiting, explicit end-run, zero first attempts/executions/new commitments. The $4,799.99 boundary remains separate coverage. User answer is not approval. |
| P0 traceability and recovery | D07/D14; 01 X1–X5 | `convex/timeline.ts`, `convex/runs.ts`, `convex/turns.ts`, timeline/run UI | Source present. Verify timeout/retry, stale-result rejection, safe event rendering, and append-only decisions. |
| P0 provenance and truth | Core principle 8; D18 | `convex/seed.ts`, `core/engine/provenance.ts`, `SimulatedBadge` in UI | Source present. Seed inputs through actual write chain; do not prewrite approvals/executions or invent model text. |
| P0 usability and visual presentation | 13 §13.13–14 | `RoomWorkbench.tsx`, `RoomSections.tsx`, `globals.css`, `LiveAnnouncer.tsx` | Existing functional presentation is sparse. Polish without losing projected data boundaries, explicit versions, keyboard behavior, or the separation of human and agent decisions. |
| P1 follow-up and lifecycle | D04; 01 C12/X9 | `convex/rooms.ts`; release human-recovery JSON | Follow-up created once in setup with baseline suggestion of 480000 cents; baseline not recorded and requires Finance. Other lifecycle/browser paths remain separate checks. |
| P0 engineering release gate | PROCESS; 16 | `package.json`, tests, scripts, e2e harness | Frozen application code at `2950bde` passed lint, all types, tests, boundaries, Next/cloud builds, artifact scans and dependency policy. Generated drift was zero. The subsequent CI at `97c1417` passed 2,154 tests; 39 TODO; 7 skipped files. See VALIDATION.md. |
| P0 external runtime evidence | 16 L2/L3/L4 | Release smoke/recovery/public-trace JSON; e2e and probe suites | Actual cloud/model and human recovery evidence available. Full three-account browsers, full WebSocket privacy, and other battery todos remain incomplete. |

## What is intentionally not an MVP requirement

Canon D26 and product §1.3 explicitly defer LLM extraction from pasted text, email/Slack notifications, approval and quote expiry, multilingual UI, role replacement/multiple seats, cross-room shared budgets, same-room revisions/reversals, external integrations, and a second production scenario. A `procurement_rfq` contract fixture is an engine-reuse test, not a second application to build for the demo.

Do not add these merely because they appear in the roadmap. Cloud plan purchases, a domain, Axiom, and other operational defaults in design decisions are not implied requirements for the current connected demonstration.

## Release priorities

1. **Correct semantics before cosmetics.** Preserve this main baseline, fixture, role projections, exact version binding, and atomic final approval. Reject copied wrong-repository behavior.
2. **Finish and verify the connected product.** Retain working Google sign-in through Clerk and the isolated Convex backend. Complete missing editors and test real transitions in three independent sessions; do not add a parallel local adapter.
3. **Complete the presentation layer.** A strong inbox, compact three-area workbench, clear decision page, typed private inputs, visible stale approvals, role-sensitive requests, and results with causes. Keep existing routes/API contracts.
4. **Exercise the canonical story and one adverse story.** Budget cut from $5,000 to $4,800, recovery to $800, final vote executes; separate reset run at $4,700 yields a Finance request and no execution until a valid change and fresh approvals.
5. **Produce durable evidence.** Fresh test report, reproducible startup, screenshots at desktop/mobile, source-aligned video, exact commit, and explicit implemented/tested/simulated/unverified distinctions.

## Correct two-minute demonstration narrative

Use the canonical fixture in `core/scenarios/scope-change/fixtures/main.ts`. Dates are offsets from the room's `localDate`: required-only delivery +14 days, preferred phase +16 days, deadline +18 days. Read actual materialized dates from the running app; do not copy stale calendar dates into the video.

**0:00–0:20 — Changed conditions invalidate authority.** In Finance's view, show a $900 proposal with Customer and Provider approval and no Finance approval yet. Explain $4,000 already committed and the $5,000 cap. Preview and confirm reducing the cap to $4,800. Show the previous approvals no longer apply. Do not expose Finance's full budget in the Provider view.

**0:20–0:40 — Three roles, controlled disclosure.** Show the decision inbox and brief/disclosure controls. Explain that the Customer needs SSO login and Audit log export; the Provider supplies confirmed item prices and lead times; Finance owns the cap and baseline. Show that the Provider only gets an allowed fit signal. State that the room uses seeded data and identify whether this actual run uses stub or live agents.

**0:40–1:10 — Supported recovery.** Show the original $900 package: SSO $500 + audit export $300 + usage dashboard $100. After the cut, the supported $800 package retains the two required items and defers Usage dashboard. In the measured run the agents escalated, and Customer explicitly selected that existing alternative. Show that intervention rather than presenting autonomous agreement. Code validates terms; then fresh human approval is still required.

**1:10–1:40 — Exact human approval and immediate execution.** Obtain fresh Customer and Provider approval. In Finance's decision page, show the warning that its approval completes the set and executes now. Submit that approval. Display one change order, one $800 ledger commitment, and the two required delivery tasks. The new committed total is $4,800 with zero headroom, visible only to authorized viewers.

**1:40–2:00 — Evidence and honest limits.** Show the result's causal chain and timeline. Explain the stale decisions remain history and no payment or binding signature occurs. Report the actual verification level; distinguish deployed concurrency, live authentication, model activity, and serial test evidence. Only claim replay/concurrency behavior backed by the new run evidence.

Optional challenge: start a separate seeded run at $4,700. No confirmed candidate with the required items fits. Finance receives the concrete raise-cap/end-run decision; Provider sees “Waiting on others”. Raising to $4,800 is a constraint change, not approval. All required approvals are still necessary afterward.

## Submission and report checklist

| Deliverable | Required content | Audit status |
| --- | --- | --- |
| Correct source branch | Authoritative main ancestry, preserved previous history, reviewed `final_product` changes | Included and pushed to final_product, preserving main and earlier release ancestry |
| Startup instructions | Exact supported commands, intended cloud configuration, real sign-in path, separate credential-free checks | README revised: cloud primary, optional developer commands separate |
| Functional evidence | Actual scenario inputs, versions, approvals, execution ID and task/ledger counts | Available in release probes; synthetic admin identities, not Clerk sessions |
| Validation report | Commands, results, failures, tests/todos/skips, browser sizes, current commit | VALIDATION.md complete for application commit `2950bde`; code/media pushed in release `bc97ab0` |
| Video | Canonical $900 → $800 story with explicit human choice; actor-sensitive views; final approval execution | Illustrative canonical-component video complete, 177.0 seconds with media QA; not a live cloud recording |
| Visual assets | Real desktop/mobile screenshots of current build; no invented data/service claims | Canonical component fixture viewport excerpts included in submission/; actual browser homepage reviewed at desktop and mobile sizes. No authenticated live screenshots claimed |
| Integration readiness | Existing service code and missing setup names, without copied secrets or invented deployment success | Actual backend/model evidence and deployed frontend; real three-account Clerk/browser acceptance pending |
| External evidence | Model usage/cost, deployment, optional sponsor/user-research evidence and event submission | Model trace and deployment now recorded; interviews, Mana contribution and submission confirmation not established |

Do not reuse the old $900 → $700 video or report as evidence for this product. A pass means the current final-branch behavior was actually exercised. Source presence, a historical report, a skipped suite, and a future design requirement are four different things.
