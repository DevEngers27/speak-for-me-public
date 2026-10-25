# Release validation — authoritative team product

## Current released product

The final product retains the working **Google sign-in through Clerk**, with Convex authorization. The public website is https://speak-for-me-calhacks.lgc783656618.chatgpt.site, opened to public access with owner authorization at **14:35:34 UTC**. One real account signed in, opened the inbox, created a Provider room, and saved/reloaded a confirmed private brief. This does not establish the complete three-account browser workflow.

The released application baseline is `97c1417`. [CI 40202735745](https://github.com/DevEngers27/speak-for-me/actions/runs/40202735745) passed **2,154 tests**, with **39 TODOs and seven skipped files**, plus lint, types, boundaries, policy, builds and artifact scans. Authenticated browser E2E steps were skipped; they are not a workflow pass. Final packaging changes and any new CI receipt must be distinguished from this baseline.

The 177.0-second illustrative video uses Google as the identity label for sign-in through Clerk. It is not a direct GIS integration or a continuous authenticated recording. Its updated decode/subtitle/frame review passed. The seven-page PDF is aligned to this released authentication route; changed pages were visually reviewed.

The separate direct-Google implementation was deferred and preserved outside the released runtime. Its 2,177-test local result belongs to that experiment, not this released baseline; it is not added to the counts above. No new Google client ID or direct-Google deployment is required to use the current product.

## Historical validation records


Recorded October 25, 2026 (America/Los_Angeles). This review applies to the frozen `final_product` working tree based on `34b9c51` (authoritative main `df738c6` plus the team's PR 101 integration), including the cloud adapter and current frontend improvements. It is not evidence for the earlier `cal-hack-2026` product. The release commit is assigned after these checks.

## Engineering gates

Commands used bundled Node **v24.22.1** and pnpm **11.25.0**. Local logs are retained in the parent work directory as `team-final-*.log`; they contain no credential values.

| Gate | Result |
| --- | --- |
| `pnpm lint` | Passed with zero allowed warnings, through the initial `pnpm check` invocation. |
| `pnpm typecheck` | Passed for application, Convex, tests, scripts, and e2e TypeScript projects. |
| Primary repository suite | `pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=4`: **2,105 passed, 39 TODO, 0 failed**; 144 passed files and 7 skipped files (151 total). |
| Script suite | `pnpm exec vitest run --config scripts/vitest.config.ts`: **31 passed**, 5 files. |
| E2E harness unit suite | `pnpm exec vitest run --config e2e/vitest.config.ts`: **11 passed**, 1 file. No browser was launched. |
| Boundary gates | `pnpm test:boundaries` passed: 45 deliberate violations rejected, 280-file layer/constraint scans, and plugin-closure checks. |
| `pnpm policy:check` | Passed; policy reports 56 lockfile exceptions with expiry dates. This is policy compliance, not a security-vulnerability certification. |
| `pnpm build` | Passed. Public service identifiers were configured, but `CLERK_SECRET_KEY` was absent; the Next application's missing-secret path remains closed. |
| `pnpm test:build-artifacts` | Passed: 30 Next browser artifacts inspected. |
| `pnpm cloud:typecheck` and scoped cloud lint | Passed after the final adapter changes. |
| Focused cloud adapter/artifact tests | 11 passed across two files. These are included in the repository suite, not additional distinct tests. |
| `pnpm cloud:build` | Passed. Vite notes the all-client bundle's `use client` directives and a chunk above 500 kB; these are warnings, not build failures. |
| `pnpm test:cloud-artifacts` | Passed: 2 cloud browser assets inspected. |

The first full run found one integration mismatch: the runtime-dependency test allowed `@clerk/nextjs` but omitted the cloud entry's approved `@clerk/react`. The exact dependency was added; forbidden payment, ERP, signature, and email SDK mutation assertions remain intact. The focused six-test file then passed. The next full run passed 2,104 tests but exceeded the existing 60-second deadline in the 2,000-case privacy property test while builds/video rendering competed for resources. Resource contention is a plausible explanation, not a proven cause. No assertions or timeout were weakened. The isolated seven-test privacy-property file then passed in 31.25 seconds, and the complete primary suite passed with four workers in 51.96 seconds. Those failed-run logs are retained separately from the final rerun.

Across the three disjoint Vitest suites, the final total is **2,147 passing tests and 39 TODO tests**, with **150 passed files and 7 skipped files**. Focused reruns and the 11 cloud/artifact tests are already included and are not counted again. The initial `pnpm check` command returned failure before the repair; its lint/typecheck stages passed. The repaired final validation ran every `pnpm test` component explicitly, constraining the primary suite to four workers. These results do not claim that the original failed invocation passed or that CI has run on the eventual release commit.

Reproduction after dependency installation:

```sh
pnpm lint
pnpm typecheck
pnpm exec vitest run --config tests/vitest.config.ts --maxWorkers=4
pnpm test:boundaries
pnpm exec vitest run --config scripts/vitest.config.ts
pnpm exec vitest run --config e2e/vitest.config.ts
pnpm policy:check
pnpm build
pnpm test:build-artifacts
pnpm cloud:typecheck
pnpm cloud:build
pnpm test:cloud-artifacts
```

The artifact gate checks private fixture markers and known credential prefixes (Clerk, Anthropic, GitHub), PEM private keys, and published source maps. It rejects empty/missing output. This targeted check is not a complete secret-discovery proof. Generated Convex files have no diff from the checked-in baseline; this review did not redeploy or rerun codegen.

## Cloud adapter review

The cloud entry reuses the canonical UI, generated API references, Clerk identity, and Convex authorization. There is no replacement negotiation engine or local data adapter. Protected content waits for authentication and viewer provisioning. Backend creator, membership, role, and single-use invite checks remain authoritative.

Fixed and covered regressions include invitation retention through sign-in, token-free Clerk return URLs, exact page-route shapes, recoverable invalid-room errors, fragment-change notifications, native new-tab/modified/named-target/download links, and unsaved-draft navigation cancellation. Invite secrets stay in the URL fragment and a short-lived, same-tab session-storage entry during sign-in; they are not copied into a redirect query string. Session storage must be available for this return flow. No browser admin key is used.

## Browser observations

The integration lead verified the local cloud homepage, the unsigned sign-in gate, and `/invite#t=review-only-placeholder`. Clicking Sign in opened the actual Clerk modal while the invitation fragment remained in the address and no invitation-bearing redirect query appeared. At **390 × 844**, the homepage was visually clean and its scroll width equaled its 390-pixel client width.

These observations do **not** establish successful Clerk login, three independent member sessions, authenticated editor save/reload, multi-user WebSocket updates, or a complete desktop/mobile accessibility audit. Playwright browser smoke and stage-B workflows were not run with three real Clerk identities in this review. The `e2e` Vitest suite below tests the harness; it must not be described as a browser workflow pass.

## Deployed evidence, separately classified

Existing evidence was reviewed without issuing additional model calls or deployments:

- `probe-results/2026-10-25-release-live-smoke.json` records a real live-agent run on `benevolent-jackal-41`, using seeded synthetic actors through Convex administrator impersonation. It verifies anonymous/nonmember read rejection, Provider budget-write rejection, a $900 proposal, private projections, and stale approval rejection after a $5,000 → $4,800 cap change. The second negotiation reached `needs_input` / `rounds_exhausted`; **the autonomous smoke result is false**, not an autonomous agreement success.
- The same evidence records **7 model calls**, with a deployment-window **estimated $0.086849** cost. This is not a customer billing figure or a general performance benchmark.
- `probe-results/2026-10-25-release-human-recovery.json` records the separate authorized human recovery. A person selects the existing $800 live-model option; no new model run is started. Fresh approvals yield one execution, one ledger commitment, one change order, one execution event, and two tasks. The recorded concurrent final-approval test remains idempotent, invariant findings are zero, and the Provider projection excludes the Finance chain.
- The recovery evidence also records an idempotently created linked follow-up room in setup. Its $4,800 baseline is a suggestion and still requires Finance confirmation.

Administrator-impersonated synthetic actors are not Clerk/browser login evidence. The initial preflight failure is retained in `probe-results/2026-10-25-release-live-smoke-preflight.json`; it must not be silently counted as a successful run.

## Remaining limits

The remaining three-account acceptance work needs separate genuine signed-in accounts; existing single-account use is already verified. The separate $4,700 deployed precheck was subsequently verified in the addendum below. Authenticated mobile flows, complete network-canary capture, and the end-user accessibility workflow remain unestablished. Existing test TODOs and excluded real-deployment suites remain outstanding coverage, not passing behavior. No payment, external signature, or ERP transaction occurs; final approval creates internal records. Event eligibility, public judge access, and Devpost submission are separate release obligations.

## Deployment and media update from integration

After the suite review, the corrected cloud frontend deployed successfully at 2026-10-25 13:52:16 UTC to https://speak-for-me-calhacks.lgc783656618.chatgpt.site. The receipt is `probe-results/2026-10-25-release-deployment.json`; Sites source commit is `7d431f6125de1c7778595bffd74be91d9631aa52`. The integration lead observed the deployed canonical homepage, protected room sign-in gate, and actual Clerk development sign-in rendering. No successful three-account login or authenticated cross-browser workflow is claimed. The audience remains owner-private; public sharing awaits owner approval.

The integration lead reports the new illustrative canonical-component video complete at 176.7 seconds, 1080p, 30 fps, H.264/AAC; full decode, subtitle checks and 12-scene visual review passed. The seven-page PDF is ready. Media packaging and upload-access checks are separate from these completed file checks. This addendum does not change the suite counts or limitations above.

The validated application source was committed as `2950bdec417afa444d6c330ffb3bb3c166ec2b64`; the product/video/report bundle was pushed in `bc97ab0`. Subsequent documentation-only updates do not change that tested application source. PDF, video, subtitles, editable source archives and illustrative screens are present under `submission/` with checksums.

## Post-release real-account check and bounded fixes

The published app also passed a **single actual Clerk account** Google sign-in, decision-inbox load and creation of a clearly labeled Provider test room through the UI. This evidence is in `probe-results/2026-10-25-release-browser-smoke.json`. It is not a three-account acceptance result.

This check revealed two frontend issues: the invite form defaulted to the occupied Provider seat, and a private-notes-only save incorrectly warned that those same notes might be discarded. App commit `3dca2b2` fixes both. The first available empty seat is selected, filled seats are disabled, and all-filled rooms disable invitations; existing permitted invitation reissues remain available. Notes persisted by initial Provider/Finance confirmation no longer count as an unrelated dirty section; actual unsaved catalog changes still require confirmation. Seven focused regressions were added. TypeScript, scoped ESLint and all **168 frontend tests** passed. Across the earlier full validation and these seven new distinct tests, **2,154 tests passed**; that arithmetic alone is not a claim that the entire suite was rerun on the fix.

The prior complete GitHub CI run on `947013f` passed: https://github.com/DevEngers27/speak-for-me/actions/runs/40200013204 . Its browser e2e steps were explicitly skipped because credentials/configuration were absent, even though the gate job succeeded. The fixed application was republished at 2026-10-25 14:09:28 UTC, Sites source commit `0da066b4b99451e5d0fae0f2a9a0b497e3c53d4c`. Cloud typecheck/build/artifact scans passed.

## Final CI and deployed infeasibility addendum

[CI run 40201150383](https://github.com/DevEngers27/speak-for-me/actions/runs/40201150383) on `50287584931dabff4ad2b795d32294b738c9efe3` completed successfully: 2,112 primary tests, 31 script tests and 11 harness unit tests, totaling **2,154 passes**, plus 39 TODOs and seven skipped files. Browser E2E steps were skipped because their required configuration was absent. This supersedes the earlier across-run count, without converting skipped browser checks into successes.

At 14:29 UTC, `scripts/release/infeasible-smoke.mjs` exercised the deployed canonical fixture stopped before Finance confirmation, then confirmed a $4,700 cap against $4,000 committed plus $800 required scope. Evidence: [release-infeasible-smoke.json](../../probe-results/2026-10-25-release-infeasible-smoke.json). Finance received an infeasible request with raise-cap/end-run choices; Provider received generic waiting and no private budget fields. The precheck created no first-turn attempts or proposal. Explicit Finance end-run left the run `ended_no_agreement`, budget unchanged, and zero executions, new commitments or tasks; invariant findings were zero. This is actual deployed behavior with synthetic admin identities, not Clerk/browser evidence or a model negotiation. The new probe script passed scoped ESLint.

Reproduce only on the explicitly confirmed isolated development deployment; this creates one synthetic room, never resets data, never raises its cap, and does not change deployment configuration:

```sh
node --env-file=.env.local scripts/release/infeasible-smoke.mjs --execute --confirm-deployment benevolent-jackal-41
```

The seven-page report and Devpost draft have been updated with this evidence. The model-call total remains seven from the earlier negotiation, not an extra model demonstration.
