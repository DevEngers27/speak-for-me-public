# Speak for Me — Devpost entry

## Project name

Speak for Me

## Tagline

AI negotiates the details. People approve the commitment.

## Inspiration

A scope change rarely belongs to one person. The customer knows what matters, the provider knows what can be delivered, and finance knows what can be spent. An agreement can look settled until one constraint changes—and yesterday's approvals may no longer be safe to use.

Speak for Me helps those people reach a workable agreement while keeping private constraints private and leaving the commitment in human hands.

## What it does

Speak for Me is a shared workspace for Customer, Provider, and Finance. Each participant confirms a private brief and decides which fields to share. The provider confirms catalog prices and lead times. Agents recommend supported options; deterministic code checks scope, budget, dates, and source revisions.

The demonstration starts with a $5,000 cap, $4,000 already committed, and a $900 package: SSO login, Audit log export, and an optional Usage dashboard. Two people approve. Finance then lowers the cap to $4,800. The old approvals stop applying, and a supported $800 alternative keeps the required features while deferring the dashboard.

In the recorded real model run, the agents asked for human input. Customer explicitly selected the $800 alternative, and all three participants approved the new version. The final vote atomically recorded one change order, one budget commitment, and two delivery tasks. No money moved and no binding contract was signed.

When no option fits, Finance can address the budget or end without agreement. Completed rooms preserve their history; later changes start a linked follow-up room.

## How it was built

The architecture uses a pure TypeScript engine for deterministic rules, privacy projections, candidate construction, and exact approval contracts. Convex handles authorized data access, live state, scheduling, and transactional execution. Claude runs in separate participant contexts. Google sign-in through Clerk provides identity, while backend membership and role checks control room access.

The React interface centers on a decision inbox, private briefs, proposals, human requests, results, and a timeline. Next.js and a thin Vite hosting adapter reuse the same components and Convex API. The deployed product runs against a real Convex backend.

## Challenges

Privacy required more than hiding a budget panel. Provider must not receive Finance's cap, commitments, headroom, or private budget-derived explanations. The application projects data before it reaches another participant's browser or agent.

Approval also had to remain correct when constraints changed or requests were repeated. Each decision binds exact terms and a constraint version. Execution belongs to the final valid vote and must happen once.

Finally, agents did not always agree. The product preserves the real human-input stop and provides an explicit recovery path rather than presenting that outcome as autonomous success.

## Accomplishments

- Seven real Claude calls produced the $900 proposal and $800 alternative. The budget change invalidated old approvals, and a stale approval attempt was rejected.
- Human recovery created one execution, one ledger commitment, one change order, and two tasks. The deployed probe passed duplicate-final-approval and scoped privacy checks.
- A separate $4,700 scenario ended without agreement after Finance's explicit choice, with no first model attempt or new commitment.
- One real account completed Google sign-in, loaded the inbox, created a Provider room, and saved/reloaded its private brief on the public website.
- The released application baseline passed 2,154 tests, with 39 TODOs and seven skipped files. Engineering CI passed; the full three-account browser workflow remains unverified.

The backend probes used synthetic identities through administrator impersonation, separately from the real-account browser check. The video uses canonical React components with illustrative fixtures; it is not a continuous authenticated recording. Its Google identity label refers to sign-in through Clerk.

## What was learned

Negotiation assistance works best when recommendation, tradeoff choice, and approval are separate actions. Selecting an option must not silently approve it, and a changed constraint must invalidate previous authority immediately.

A useful outcome can also be a specific request for a person's decision. Keeping the model's escalation visible made the recovery path testable and the system's limits clear.

## What's next for Speak for Me

Complete the full three-account browser acceptance run, expand changed-deadline and infeasibility coverage, and evaluate model quality across more scenarios. Feedback from people who manage outsourced software changes is another next step. Customer savings have not been measured, and the product does not claim to replace procurement or legal review.

## Built with

TypeScript, React, Next.js, Convex, Claude, Google sign-in through Clerk, Vite, Vitest, Playwright test tooling, and GitHub Actions.

## Brief spoken pitch

“Two people approved this $900 scope change. Then Finance lowered the cap. Speak for Me invalidates the old approvals and helps the participants consider supported alternatives without exposing private constraints. In the recorded real model run, the agents asked for human input. Customer chose the $800 essentials option, all three people approved the new version, and the final vote recorded the change order and tasks. Agents recommend; code checks the rules; people make the commitment.”

---

## Submission fields and human handoff — do not paste as project story

| Field | Value / required action |
| --- | --- |
| Entry participant | The user confirmed a single participant and no teammates. Do not add invented collaborators. This entry status does not claim sole authorship of the existing repository or replace contributor credit. |
| Entry eligibility | Confirm actual accepted/check-in status. The overview’s 2–4-member text conflicts with its Best Solo Hack prize; do not infer ineligibility solely from that text. Seek organizer clarification if the form or judging process makes it necessary. |
| Sponsor categories | **[HUMAN: select only intended categories whose conditions are met.]** Sponsor requirements are separate from general entry rules. |
| Live product | https://speak-for-me-calhacks.lgc783656618.chatgpt.site |
| Live access | **Public website.** Google sign-in through Clerk protects rooms. [HUMAN: verify the intended judge workflow and supplied repository/video links.] |
| Source code | https://github.com/DevEngers27/speak-for-me/tree/final_product |
| Reviewed source revision | Released application baseline `97c1417`; final packaging commit recorded by the release lead |
| Repository access | **[HUMAN: verify judges can read the supplied branch through the intended arrangement.]** |
| Devpost video URL | [Watch the demonstration](https://youtu.be/GpGHtLMbCKw) — uploaded as unlisted; YouTube checks reported no issues. Verify the Devpost embed after saving. |
| Project image | Use `submission/speak-for-me-team-poster.png`; it depicts the illustrative canonical UI. |
| Final review | Check the project story, selected categories, confirmed single participant, and all access links before submission. |
| Devpost working entry | [Speak for Me preview](https://devpost.com/software/speak-for-me-wgp9ck), project ID `1263563`; renamed from Untitled. Latest observed progress: 2/5, with content editing in progress. |
| Submission confirmation | **Not submitted yet.** Record the actual submission receipt after the authorized upload is complete; a preview URL is not proof of submission. |

### Packaged assets

- Hosted video: [YouTube demonstration](https://youtu.be/GpGHtLMbCKw), unlisted; no issues reported by upload checks.
- Video file: [speak-for-me-team-demo.mp4](speak-for-me-team-demo.mp4), 177.0 seconds, 1080p, with English narration and captions.
- Subtitles: [speak-for-me-team-demo-en.srt](speak-for-me-team-demo-en.srt).
- Poster: [speak-for-me-team-poster.png](speak-for-me-team-poster.png).
- Seven-page report: [speak-for-me-team-product-report.pdf](speak-for-me-team-product-report.pdf).
- Video source: [speak-for-me-team-video-source.zip](speak-for-me-team-video-source.zip).
- Report source: [speak-for-me-team-product-report-source.zip](speak-for-me-team-product-report-source.zip).
- Asset checksums: [SHA256SUMS.txt](SHA256SUMS.txt).

These paths are relative to the `final_product` repository root when prefixed with `submission/`. The video and poster are illustrative; do not label them as customer evidence or a live three-account recording. Do not use the older incompatible $900 → $700 assets.

### Evidence links for reviewers

- [CI for released baseline 97c1417](https://github.com/DevEngers27/speak-for-me/actions/runs/40202735745): passed; browser test steps skipped without their required configuration.
- [Engineering validation](../docs/release/VALIDATION.md): test counts, prior failures, fixes, and evidence limits.
- [Live model smoke](../probe-results/2026-10-25-release-live-smoke.json): seven live calls; autonomous result remains `pass: false` at human-input escalation.
- [Explicit human recovery](../probe-results/2026-10-25-release-human-recovery.json): chosen alternative, fresh approvals, recorded outcome and follow-up.
- [Deployed infeasible-budget check](../probe-results/2026-10-25-release-infeasible-smoke.json): $4,700 precheck, private Finance request and explicit no-agreement result, with no first model attempt.
- [Safe public trace](../probe-results/2026-10-25-release-public-trace.json): Provider-visible history and model metadata without prompts or private notes.
- [Actual-account browser check](../probe-results/2026-10-25-release-browser-smoke.json): one real Google-via-Clerk account, inbox, room creation, and Provider brief save/reload; not three-account acceptance.
- [Official submission checklist](../docs/release/SUBMISSION_CHECKLIST.md): source-linked event rules, optional sponsor conditions, and access checks.

### Optional sponsor notes — choose, verify, then adapt

**Convex:** Explain the real backend's authorized functions, stored rooms, versioned decisions, and transactional final-approval execution. Point to deployed probe evidence; do not substitute component tests for multi-user subscription evidence.

**Hyphenate:** Emphasize a financial coordination job with limited authority: check supported scope, invalidate stale approvals, ask for a concrete human tradeoff, and retain the resulting work record. Keep the human intervention explicit.

**Microsoft:** Describe the intended users and practical workflow. Customer interviews and measured savings are not established; do not invent them or treat an interview count as a universal event rule.

**Mana:** Do not select or claim this category on the strength of this draft. **[HUMAN: provide actual qualifying Mana contribution and the sponsor's required accessible evidence, or omit the category.]** Missing Mana evidence does not make a general entry ineligible.

This file does not confirm submission. Record the actual Devpost entry and receipt after the authorized upload is complete.
