# Speak for Me — connected product report

Updated October 25, 2026, America/Los_Angeles from the release probe files listed below. Real Convex/model evidence is now available; corrected frontend publication has succeeded, while three-account Clerk/browser acceptance remains pending. This report preserves failed and human-assisted outcomes rather than presenting them as autonomous success.

The released app uses **Google sign-in through Clerk**, with Convex enforcing room membership and role permissions. This is the working public product; no new direct Google client setup is required to use this release.

## Product

Speak for Me helps a software customer, service provider, and finance reviewer agree on a scope change without losing control of private constraints or spending authority. Each person confirms a structured brief and chooses which fields to disclose. Agents recommend supported terms; deterministic code validates them; people approve an exact version. The final required approval atomically records the internal outcome.

The target situation is a project whose scope, available budget, or delivery requirements change while an agreement is being reviewed. This is a product hypothesis and a seeded demonstration scenario, not a claim of customer adoption or measured savings.

## Correct source and integration

The release is based on `DevEngers27/speak-for-me` main `df738c6`, preserving the team's core engine, normalized Convex data model, role projections, API, frontend routes, and tests. Subsequent integration includes the team's PR 101 request-consent and stale-proposal fixes. The delivery branch remains `final_product` as requested.

The earlier `cal-hack-2026` implementation and its $900 → $700 demonstration are incompatible with this product. Its video, shared-budget view, free role picker, persisted chat, and separate execution button must not serve as evidence for this release.

The isolated Convex backend `benevolent-jackal-41` has now executed the measured release workflow. A thin SPA hosting adapter in `cloud/` reuses canonical React components and generated API calls; it adds no second engine. Its latest corrected deployment succeeded at 14:09:28 UTC on October 25, 2026, at [the existing product URL](https://speak-for-me-calhacks.lgc783656618.chatgpt.site). The website became public with owner authorization at 14:35:34 UTC; rooms remain protected by Google sign-in through Clerk and membership checks. Sites source commit: `0da066b4b99451e5d0fae0f2a9a0b497e3c53d4c`. This deployment commit is distinct from the final repository release commit. Localhost remains only a developer option. A credential-free business adapter is not part of this release; protected rooms continue to require authentication.

## Implemented source surfaces

The following functionality is present in the inspected source. The verification ledger distinguishes code presence, cloud probe evidence, component tests, and still-pending authenticated browser acceptance.

| Surface | Behavior | Evidence location |
| --- | --- | --- |
| Decision inbox | Separates required decisions, agents working, waiting, and completed/no-longer-needed work | `src/components/inbox/` |
| Room workbench | Shows current versions, role-projected brief/shared facts, proposal, decisions, and run/timeline state | `src/components/room/RoomFrame.tsx`, `RoomWorkbench.tsx` |
| Private briefs | Customer required items/deadline; Provider guidance/catalog; Finance baseline/cap; explicit disclosure | `RoomSections.tsx`, `RoomScreens.tsx`, `convex/briefs.ts` |
| Catalog and budget editors | Confirm/retire published item revisions, prices and lead times; record baseline; preview and update cap | `convex/catalog.ts`, `convex/ledger.ts`, `convex/budget.ts` |
| Deterministic negotiation boundary | Materializes candidate terms from confirmed catalog; validates amounts, scope, dates, and sources | `core/engine/`, `core/scenarios/scope-change/` |
| Agent runtime | Isolated role contexts, structured actions, bounded retries, stub/live driver boundary | `convex/model/agents/`, `convex/runs.ts`, `convex/turns.ts` |
| Human decisions | Approve, reject, or withdraw with exact constraint version and terms key | `convex/approvals.ts`, proposal decision screen |
| Atomic outcome | Final required approval calls execution in the same transaction; records change order, ledger commitment and tasks | `convex/model/executions.ts`, `convex/executions.ts` |
| Requests and recovery | A specific authorized person receives tradeoff or failure options; other roles see safe waiting information | `convex/humanRequests.ts`, request screen |
| Results and follow-up | Role-projected outcome, task completion, append-only history, separate follow-up room | `convex/tasks.ts`, `convex/timeline.ts`, `convex/rooms.ts` |

Current frontend changes complete editors and improve drafts, consent, labels, and the canonical layout. [CI 40202735745](https://github.com/DevEngers27/speak-for-me/actions/runs/40202735745) for `97c1417` passed 2,154 tests across three disjoint suites, with 39 TODO tests and seven skipped files; focused frontend runs are subsets, not additional counts. Browser E2E steps were skipped for missing configuration. This does not establish three-account browser operation: actual save, disclosure, preview, and error paths still need that check. The existing generated Convex API remains the contract.

## Canonical scenarios

### Budget changes during approval

Finance has a $5,000 cap and $4,000 already committed. Confirmed catalog items include SSO login at $500, Audit log export at $300, and Usage dashboard at $100. Customer requires the first two; the dashboard is optional.

A $900 phase includes all three. Customer and Provider approve it; Finance has not yet approved, so nothing executes. Finance then previews and confirms a reduction to $4,800. The old plan exceeds the remaining budget by $100, and the old approvals no longer apply.

The real model run produced an $800 proposal preserving SSO and Audit log export while deferring Usage dashboard. It then reached `needs_input` with a `rounds_exhausted` request rather than autonomously agreeing. Customer explicitly selected that existing proposal. Three fresh approvals followed; the last one recorded the outcome: total commitments $4,800, no remaining headroom, and two required-item tasks. There was no separate “Execute” step. The human choice was a real intervention, not hidden simulation or model agreement.

### No feasible agreement at $4,700

With the same $4,000 baseline and required scope, the cheapest supported required-only option costs $800. A $4,700 cap cannot fund it. The separate deployed probe passed at 14:29 UTC: Finance received supported raise-cap choices and an end-without-agreement option; Provider received generic waiting and no private budget fields. Finance explicitly ended the run. The cap and committed balance stayed unchanged, with no execution, new commitment, tasks or first-turn model attempts. These checks used synthetic admin identities, not a browser workflow. See `probe-results/2026-10-25-release-infeasible-smoke.json`. Answering a request is not proposal approval.

### Delivery and provider changes

Catalog lines carry confirmed prices, lead times, revisions, and task templates. A changed price, required scope, deadline, or relevant constraint triggers a recheck and may invalidate earlier authority. Materialized delivery dates are stored with the proposal rather than recomputed on every screen. The main fixture uses relative dates: required-only delivery +14 days, preferred phase +16 days, and deadline +18 days from the room's date.

### Follow-up after execution

An executed room is terminal. Provider can complete its tasks; a new change starts a separate follow-up room linked to the previous outcome. The measured recovery probe created that follow-up exactly once in `setup`, with a suggested $4,800 baseline. It did not record that baseline automatically: Finance confirmation remained required. Task completion itself is not evidenced by this probe.

## Privacy and human control

Provider never receives Finance's cap, committed balance, headroom, or private budget-derived checks. Customer sees only explicitly disclosed fields; the main fixture shares the cap but not commitments or headroom. Own notes and agent rationale remain private to the participant. Public explanations use controlled templates, and projections occur before data reaches a browser or another agent.

Agents cannot approve, invent supplier prices, or transfer funds. Approval binds the current immutable terms, constraint version, and individual member. A final vote is therefore an explicit financial authorization for internal record creation, and the UI must explain that effect before submission.

The live probes rejected anonymous/non-member reads and Provider budget writes, and passed their role-projection checks. The public trace excludes private finance-chain data and model prompts, outputs, and notes. This is scoped evidence, not a blanket privacy certification: Clerk/browser, WebSocket/RSC, and comprehensive model-context checks remain distinct. A hidden budget widget alone would not establish privacy.

## Release verification ledger

| Evidence | Current status | Required final record |
| --- | --- | --- |
| Authoritative baseline and PR 101 | Included | Final release commit still to be recorded |
| Isolated backend and frontend | Actual backend probes; corrected SPA deployed successfully | Homepage, room sign-in gate and Clerk modal rendering checked; public website |
| Authentication | Working Google sign-in through Clerk; backend probes separately use synthetic admin impersonation | One real account passed sign-in, inbox, Provider room creation and brief save/reload; three-account sync remains pending |
| Editors and frontend | Tested in the final component/repository suite | Provider brief save/reload passed with one real account; other-role and three-account workflows remain pending |
| Initial preflight | Failed before model calls | `release-live-smoke-preflight.json` retained |
| Live $900 → $800 run | Seven real calls; stale approval rejected; stopped at human request | `release-live-smoke.json` remains `pass: false`; autonomous completion was not achieved |
| Explicit human recovery | Passed | `release-human-recovery.json`: Customer choice, three fresh votes, final-vote execution |
| Duplicate final approval | Probe reports idempotent; one execution/commit/order/event, two tasks, zero invariant findings | Scoped to the deployed recovery probe; no broader concurrency claim |
| Privacy/permissions | Tested anonymous/non-member and Provider-write rejections; projected payload checks passed | Full browser/network/context coverage remains pending |
| Follow-up | Created once, setup, baseline suggestion unrecorded | Finance must confirm baseline; task completion not tested here |
| $4,700 infeasible request | Deployed precheck and explicit end-run passed | Finance request; Provider generic wait; no first model attempt, execution or commitment |
| Engineering validation | CI `97c1417`: 2,154 tests passed; 39 TODO; 7 skipped files; engineering gates passed | See VALIDATION.md; browser E2E steps skipped, not a three-account pass |
| Video and PDF | 177.0-second 1080p/30fps H.264/AAC video completed; decode/subtitle and review of unchanged scenes and updated identity/closing frames passed; 7-page PDF ready | Video, subtitles, poster, screenshots and source archive packaged in submission/; PDF and its editable source are included; video-host upload/access remains to finalize; video is illustrative |
| Judge access | Public website by owner authorization; rooms require sign-in and membership | Verify repository/video links and intended judge workflow; full three-account acceptance remains pending |

### Evidence files and measured sample

[VALIDATION.md](VALIDATION.md) records the complete engineering gate. The e2e harness unit tests launched no browser; full Playwright smoke/stage-B with three real identities was not run. Existing TODOs and skipped files remain incomplete.

- [Failed preflight](../../probe-results/2026-10-25-release-live-smoke-preflight.json): no model usage; failure is retained.
- [Live smoke](../../probe-results/2026-10-25-release-live-smoke.json): actual runtime, seven calls, first proposal, budget invalidation, and honest stop for human attention.
- [Human recovery](../../probe-results/2026-10-25-release-human-recovery.json): explicit choice of the existing model proposal, exact approvals, atomic records, retry result, and follow-up.
- [Public trace](../../probe-results/2026-10-25-release-public-trace.json): safe Provider timeline and seven completed `claude-opus-5-5` attempt metadata records, excluding prompts, outputs, and private notes.

The seven-call measurement window reports 5,312 input tokens, 1,100 output tokens, 8,471 cache-creation tokens, 6,228 cache-read tokens, and 330 thinking tokens. Estimated cost is **$0.086849**, using a price table dated October 6, 2026; this is an estimate, not an invoice. Reported turn latency is p50 4,106 ms and p95 4,448 ms, with only seven observations. The measurement window is deployment-wide and cannot establish typical performance or savings. No controlled comparison or customer outcome was measured.

Serial Convex tests do not establish deployed OCC behavior. The deployed recovery probe's own result is evidence for the checks it performed, not every concurrency scenario in the design. A skipped browser suite is not a passed workflow. Keep earlier evidence separate from final-commit evidence.

### Video and hosting disclosure

The new `speak-for-me-team-demo.mp4` is complete: 177.0 seconds, 1920 × 1080, 30 fps, H.264/AAC. Full decode, subtitle checks, and a review of unchanged scenes and updated identity/closing frames passed. It uses the actual canonical React components with illustrative UI fixtures. It explains the product and must remain labeled as illustrative. The Google identity label means Google sign-in through Clerk. It is not evidence of a direct GIS integration or a recording of sign-in, three-browser synchronization, or the seven-call trace. The video, subtitles, poster, screenshots and source archive are now packaged under `submission/`. The seven-page product PDF and editable source are aligned with the released Google-via-Clerk product and included in `submission/`; uploaded-media access checks remain pending. The old video is incompatible and must not be reused.

The corrected SPA is deployed at the product URL above. [The deployment receipt](../../probe-results/2026-10-25-release-deployment.json) records success, the Sites source commit, and observed homepage/sign-in behavior. The website is public with owner authorization at 14:35:34 UTC. One actual Google-via-Clerk account saved and reloaded a Provider brief. Full three-account acceptance and supplied repository/video access remain separate checks.

## Remaining boundaries

V1 intentionally excludes conversational brief extraction, email/Slack notifications, external ERP/payment/signature actions, cross-room shared budgets, multi-seat roles, and same-room revisions after execution. Seeded inputs remain labeled even with real models and storage. Use [SUBMISSION_CHECKLIST.md](SUBMISSION_CHECKLIST.md) to distinguish verified event-wide rules from optional sponsor conditions. Judge access, media, and submission confirmation need entry checks. Three-account browser acceptance is our product gate, not a universal event rule; Mana evidence applies only to that optional category. User interviews and measured savings are not verified universal requirements. Their absence must not be described as general ineligibility. Unsubstantiated sponsor claims remain pending and no award qualification is guaranteed.

### Real-account follow-up

A separate single-account browser smoke authenticated with Google sign-in through Clerk and created a Provider test room. Two observed UI defects were fixed at application commit `3dca2b2`: occupied invite-seat selection and a false unsaved-note warning. Seven new regression tests passed; 168 frontend tests now pass. The prior full validation plus these seven new distinct tests covers 2,154 passing cases, with 39 TODOs; see VALIDATION.md for exact run boundaries. This is not three-member acceptance. The patched app was deployed on October25 at14:09:28UTC, Sites commit `0da066b4b99451e5d0fae0f2a9a0b497e3c53d4c`.
