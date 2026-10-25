# Connected demonstration and video script

This script uses the authoritative `DevEngers27/speak-for-me` product. The former $900 → $700 video is incompatible and must not be reused. The completed 177.0-second video is an illustrative canonical React-component walkthrough, not a live three-account recording. It passed full decode, subtitle checks and 12-scene visual review. The actual seven-call cloud trace and explicit human recovery are documented separately in `PRODUCT_REPORT.md` and the release probe JSON files. Google identity in the video refers to the working Google sign-in through Clerk. One actual account is verified; full three-account verification remains pending; do not imply the illustration proves it.

## Recording preparation

1. Deploy the exact intended revision to the isolated backend and serve the frontend with its matching public URL and working Google sign-in through Clerk. Keep secret values out of terminal capture and recordings.
2. Use three separate signed-in browser contexts: Customer, Provider, Finance. Check the visible role and room membership before recording.
3. Prepare the canonical `scope_change/main` synthetic room through the existing authorized development fixture path. Do not insert fake proposals, approvals, or executions directly. Keep seed/reset tooling outside the product interface.
4. Confirm the actual agent mode. Say “stub agents” if scripted deterministic decisions are used; say “live model” only after the actual model call succeeds. Seeded catalog and account data remain simulated in either mode.
5. Rehearse the $900 proposal with only Customer and Provider approved. The third approval would execute immediately, so leave Finance pending before the budget-cut opening.
6. Verify the exact labels and dates in the final UI. Prefer the Finance browser for budget arithmetic; never imply Provider is entitled to the same figures.

## Main scenario and visual sequence

| Shot | Action | What must be true |
| --- | --- | --- |
| Finance opening | Show $5,000 cap, $4,000 committed, and $900 proposal with two approvals | Proposal remains unexecuted; Finance approval is pending |
| Budget impact | In **My brief**, enter $4,800; use the cap update and confirm the impact preview | Earlier approvals become inapplicable; old plan cannot execute |
| Role context | Show **Decision inbox**, then brief/disclosure and Provider's room view | Provider has no private budget numbers; agent suggestions are distinct from human decisions |
| Revised terms | Show new required-only proposal | SSO $500 + Audit log export $300 = $800; Usage dashboard $100 deferred |
| Exact approval | Customer and Provider review and approve the new terms | Fresh version-bound decisions |
| Final vote | Finance reviews the final-approval effect and approves | Same transaction records the outcome; no separate Execute control |
| Results | Show change order, commitment, tasks, and timeline | One outcome; Finance sees $4,800 total and zero headroom |
| Continuity | Provider completes a task; optionally show follow-up action | Only authorized task editing; follow-up uses a new room |

Dates derive from the room's local date. The canonical required-only lead time is 14 days, preferred phase 16 days, and deadline 18 days. Show the running application's materialized dates instead of narrating fixed dates from an older recording.

## Two-minute English narration

**0:00–0:20 — The commitment changed before approval finished.**

“Two people have approved this $900 scope change. The project has a $5,000 cap and $4,000 already committed. Finance now reduces the cap to $4,800. The old plan is $100 over budget, and its old approvals no longer authorize it.”

**0:20–0:40 — Private boundaries, shared decisions.**

“Speak for Me coordinates a customer, a software provider, and a finance reviewer. Each confirms their own brief and chooses what to disclose. The provider sees the agreed catalog and an allowed fit signal, not Finance's private budget. These are seeded demonstration inputs; this run uses [state actual agent mode].”

**0:40–1:10 — Recover using confirmed terms.**

“The original package includes SSO login, Audit log export, and a Usage dashboard. SSO and export are required. The model proposed an $800 alternative but the run needed human input. Customer explicitly chose that existing alternative. It retains both required items and defers the dashboard. Prices and dates come from confirmed sources; the choice still requires fresh approvals.”

**1:10–1:40 — Humans approve the exact version.**

“Customer and Provider now approve the revised terms. Finance sees that its approval completes the set and executes immediately. That final vote records one change order, an $800 budget commitment, and the delivery tasks together. Total commitments now equal the $4,800 cap.”

**1:40–2:00 — A traceable outcome.**

“The timeline preserves what changed, which earlier decisions stopped applying, and what people finally approved. The recorded outcome is internal: no money moves and no contract is signed. Later work starts a linked follow-up room, preserving this agreement.”

Replace the mode placeholder before recording. Do not claim a measured speedup, customer result, live model success, or deployed concurrency result unless the corresponding release evidence exists.

## Optional challenge: no feasible agreement

Use a separate fresh synthetic room with a $4,700 cap and the same $4,000 baseline. Required items still cost $800, so no supported candidate fits.

Show Finance's request to raise the cap to a supported value or end without agreement. Show Provider's safe **Waiting on others** view. Explain: “No agreement is a valid outcome. The system asks the person who can make the tradeoff. Answering this request changes constraints; it does not approve spending.” After a valid cap change, a current proposal and fresh human approvals are still required.

## Optional challenge: changes and follow-up

- Customer changes a required item or deadline through the structured editor; preview and confirm the impact, then show invalidation and recheck.
- Provider changes a confirmed catalog line; show a new revision and its effect on current authority.
- After execution, Provider completes a task and another member starts the linked follow-up room. The original remains immutable history.
- To answer retry/concurrency questions, show the actual deployed probe results. Do not simulate a second execution button or present serial test evidence as overlapping cloud transactions.

## Capture log

| Item | Evidence to fill after the real run |
| --- | --- |
| Frontend URL and exact commit | https://speak-for-me-calhacks.lgc783656618.chatgpt.site · Sites commit `0da066b4b99451e5d0fae0f2a9a0b497e3c53d4c`; released application baseline `97c1417`, final packaging revision recorded separately |
| Intended backend and deployed revision | `benevolent-jackal-41`; frontend deployment receipt in release probe results |
| Three distinct authenticated roles | Pending |
| Seeded fixture and actual agent mode | Pending |
| Old/new proposal and constraint versions | Pending |
| Final approvals and execution ID | Pending |
| Ledger/task count and authorized refresh | Pending |
| Role privacy checks | Pending |
| Infeasible request target and outcome | Pending |
| Video and screenshot paths | `submission/speak-for-me-team-demo.mp4`, `submission/speak-for-me-team-{provider,proposal,results}.png`; explicitly illustrative |
| Failures and known gaps | Pending |

Record only the product and safe diagnostics. Keep test credentials, secret values, invitation tokens, private notes, and unrelated account details out of the video.
