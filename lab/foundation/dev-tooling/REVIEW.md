# Review: @speak-for-me/dev-tooling (lint boundaries, ops scripts, CI template)

Reviewer verdict: **merge after fixes**. Fix r01 before merging. The other items can be follow-ups.

## 1. Re-run of the author's claims

Re-run on Node v24.21.0 / npm 11.19.0 against the existing `node_modules`:

| Command | Result |
| --- | --- |
| `npm run typecheck` | exit 0 |
| `npm test` | 4 files, 104/104 passed |
| `npm run lint:fixtures` | 25 fixture files, 0 mismatched |
| `npm audit` | 0 vulnerabilities |
| `npm ls --depth=0` | matches the README dependency table |

The claims `tests_passed=true` and `typecheck_passed=true` hold.

### Compile-time type safety (verified)

A probe outside the package (`scratchpad/review-dev-tooling/tsc/`) imports the public API with the package's strict options. Misuses that should fail did fail with `tsc` exit 2. A valid-usage file in the same run, which includes a `@ts-expect-error` on `plan.command` for a `refused` plan, compiled clean:

```
should-fail.ts(6,22):  TS2345 Property 'rootDir' is missing ... 'BoundaryConfigOptions'
should-fail.ts(7,17):  TS2561 'engin' does not exist in type 'Partial<BoundaryLayout>'
should-fail.ts(8,16):  TS2540 Cannot assign to 'engine' because it is a read-only property
should-fail.ts(9,20):  TS2322 Type '"yarn"' is not assignable to type 'PackageManager | undefined'
should-fail.ts(10,20): TS2739 Type '{ lint: string; }' is missing ... typecheck, test, build
should-fail.ts(11,92): TS2322 Type '"staging"' is not assignable to type 'DeploymentType'
should-fail.ts(13,20): TS2345 ... missing the following properties from type 'OpsRequest': yes, dryRun
should-fail.ts(14,20): TS2379 confirmDeployment: undefined rejected under exactOptionalPropertyTypes
should-fail.ts(15,24): TS2322 Type '"browser"' is not assignable to type 'EnvLocation'
```

The `OpsPlan` discriminated union also works as intended: `command` exists only on the non-refused variants.

### Domain neutrality

Searching the sources, templates, fixtures and README for room, proposal, approval, budget, customer, provider, finance, change order, money and similar terms finds no business tables, states or function names. The only domain word is "negotiation engine" in a doc comment, and the brief has already decided that the engine/scenario split exists. `convex-ops` does not know any function name, which is good.

### Consistency with the brief's core

Money and template privacy do not apply to this package. What does apply:

- `check-env` only ever handles names and booleans.
- The deploy-key secret half is never read into a variable.
- CI needs no secrets.
- Canary tests cover stdout, stderr and return values.

The one place where the package fails its own safety promise is r01.

## 2. Issues

### r01 (high): the convex-ops guard inspects a different environment than the Convex CLI it spawns

`planOperation` resolves the target from `process.env`, which holds the shell environment plus whatever `node --env-file-if-exists=.env.local` loaded. The spawned `npx convex run` then loads `.env.local` **and `.env`** on its own (`convex/src/cli/lib/deploymentSelection.ts:572-575`, `dotenv.config()` without override). It also gives `CONVEX_DEPLOY_KEY` / `CONVEX_DEPLOYMENT_TOKEN` precedence over `CONVEX_DEPLOYMENT` (lines 678-760, "we don't verify that there aren't other env vars"). A selector that only the CLI sees therefore wins.

Reproduction, using fabricated values only. `.env.local` contains `CONVEX_DEPLOYMENT=dev:happy-cat-123` and `.env` contains `CONVEX_DEPLOY_KEY=prod:fabricated-prod-999|FABRICATED_CANARY`:

```
$ node --env-file-if-exists=.env.local src/scripts/convex-ops-cli.ts reset --dry-run --confirm-deployment happy-cat-123
Target: dev deployment "happy-cat-123" selected by CONVEX_DEPLOYMENT
Would run: npx convex run ops/data:reset '{}'
exit=0
```

With `--yes`, the CLI would act on the **prod** deploy key. The same happens when the user forgets `--env-file-if-exists` and `.env.local` holds a deploy key. README line 88 ("Deployment selection stays in the environment that the guard inspected") is therefore false.

Fix (small, local):

1. Pin the child environment. For each selector variable that is not part of the resolved selection (`CONVEX_DEPLOY_KEY`, `CONVEX_DEPLOYMENT_TOKEN`, `CONVEX_DEPLOYMENT`, `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`), set it to `""` in the env passed to the runner. dotenv never overrides an existing key, and the CLI treats `""` as unset.
2. Optionally, also have the guard read `.env.local` and `.env` with `util.parseEnv`, using the CLI's no-override precedence, and refuse when the files add a selector.
3. Add tests:
   - The runner receives the blanked selectors.
   - A `.env` that carries a fabricated prod key makes the plan refuse, or pins the selection away from it.

### r02 (medium): imports into unclassified local folders bypass the boundaries

`boundaries/dependencies` with `default: "disallow"` only judges targets that belong to a known element. A probe `core/engine/probe-outside-element.ts` importing `../../shared/util` lints clean. Files outside the four layers are not linted at all, because they match no `files` glob. A layer can therefore launder a forbidden dependency through `shared/`, `lib/` or `utils/`, for example engine -> shared -> convex.

Fix: enable `boundaries/no-unknown` for the layer files, and optionally `boundaries/no-unknown-files`. If a shared folder is wanted, declare it as its own element with an explicit policy. Add a must-fail fixture.

### r03 (medium): Node built-ins are not banned in the engine and scenarios

`node:fs` and `path` in `core/engine` lint clean in the probe. The engine and scenarios are imported by Convex queries and mutations in the default runtime. That runtime is bundled with `platform: "browser"`, so any Node API use fails only at `convex dev/deploy` time (platform constraints part1, section 1.2).

Fix: add `node:*` plus the bare names from `node:module`'s `builtinModules` to the portable-layer ban list, with a fixture. Keep it overridable.

### r04 (medium): the CI template never runs this package's own fixtures

The README says that "a plugin upgrade that changes semantics fails the tests". That holds only if the consuming repo's root `test` script runs this package's vitest suite or `lint:fixtures`. The template runs `pnpm run lint/typecheck/test/build` at the root, and the README tells users to `globalIgnore` the fixtures.

Fix: add an optional step to the generator, such as `pnpm --filter @speak-for-me/dev-tooling test` or a generic `extraScripts`, enable it by default, and state the requirement in the README.

### r05 (low): gitignore-style ban patterns over-match

`group: ["react", "next", ...]` uses gitignore semantics, so a pattern without a slash matches any path segment. In the probe, a local `core/engine/react.ts` imported as `./react` is reported by `no-restricted-imports`. `@scope/react` and `x/next` would also match.

Fix: use `paths` for exact package names, plus anchored `regex` patterns such as `^(react|react-dom|next)(/|$)`, `^@clerk/` and `^convex/(server|react|react-clerk|nextjs|browser)$`.

### r06 (low): `resolveLayout` accepts duplicate folders

In `layout.ts:92`, the check `a !== b && (... || a === b)` compares values, so the `a === b` branch is unreachable. All of these are accepted:

- `{engine:"src", app:"src"}`
- `{engine:"x", scenarios:"x"}`
- `{convex:"src", convexGenerated:"src/_generated"}`, which makes convex equal to app

With duplicates, element order silently decides the classification. For example, app code would get the engine's framework bans.

Fix: iterate by key or index and reject equal values. Add test cases.

### r07 (low): integration gaps in the README and templates

- `templates/eslint.config.example.mjs` does not include `tooling/dev-tooling/fixtures/**` in `globalIgnores`, although README step 2 requires it.
- The app's root `tsconfig.json`, which in Next's default includes `**/*.ts`, must exclude `tooling/**`. Otherwise the fixtures fail to resolve, and the `.ts` import extensions need `allowImportingTsExtensions`.
- `overrides.handlebars` only applies at an npm root. When the package is consumed as a workspace package, the advisory comes back unless the root sets `pnpm.overrides`. Document this.

### r08 (low, plausible): the parser block takes over the consumer's parser

`sfm/boundaries/parser` sets `languageOptions.parser` for every layer file to this package's own `@typescript-eslint/parser` instance. Because the block comes later, it replaces whatever `eslint-config-next/typescript` configured, possibly with a different typescript-eslint version. Its `import/resolver` settings are also merged into the settings of next's `import/*` rules.

Fix: add an option to skip the parser block, or make `@typescript-eslint/parser` a peer dependency. Document that the boundary blocks should come last.

### r09 (low): the exposure heuristic misses the project's most relevant secret

`NEXT_PUBLIC_ANTHROPIC_KEY` and `NEXT_PUBLIC_CLAUDE_KEY` produce no warning. Only names that contain `API_KEY`, `SECRET` and similar are flagged (probe output: `["NEXT_PUBLIC_ANTHROPIC_API_KEY","NEXT_PUBLIC_CLERK_SECRET"]`). The platform constraints also say only Convex actions may hold the model key, yet a locally set `ANTHROPIC_API_KEY`, which reaches the Next server, is only reported as "remote".

Fix:

- Also flag `ANTHROPIC`, `CLAUDE` and a trailing `_KEY`, excluding `PUBLISHABLE_KEY`.
- Warn when a variable spec'd as `convex-deployment` is present in the local environment.

### r10 (low): `npx convex` may auto-install an arbitrary version

npm assumes `--yes` when stdin is not a TTY or in CI. If `convex` is missing locally, `npx` fetches the latest version, which may not match the 1.48 behaviour this guard was written against.

Fix: use `npx --no-install convex` or `pnpm exec convex`, or make the runner command configurable.

### r11 (low, open question): the app may import any scenario file

The policy `app -> scenario` allows importing scenario fixtures, which may contain example private briefs, into client components. That would put private-looking data in browser bundles, which goes against brief core #1.

Suggestion: once `11-architecture` fixes the scenario package shape, restrict `app -> scenario` to a public entry, for example `<scenario>/public.ts`, with a capture-based policy. Not a blocker today.

## 3. What is good

- The two complementary mechanisms are well reasoned. The fixture shows the specifier rule catching an unresolvable `@/` alias in `convex/`. The probes confirmed that re-exports, dynamic `import()` and `import type` are all caught.
- The must-fail fixtures declare exact rule ids, and an alternate-layout fixture proves the layout is not hard-coded.
- `convex-ops` is a pure planner plus an injected runner, uses a fixed argv and no shell, and its config parser rejects `__proto__`-like names and `..`. The prod floor is enforced in both the parser and the planner.
- The CI generator quotes every scalar, a drift test pins `templates/ci.yml`, and the workflow has `permissions: contents: read`.
- Every dependency is pinned and justified. The handlebars override is called out explicitly.

## 4. Reviewer verification log

```
$ npm run typecheck        -> exit 0
$ npm test                 -> Test Files 4 passed (4); Tests 104 passed (104)
$ npm run lint:fixtures    -> 25 fixture files, 0 mismatched
$ tsc (negative probe)     -> exit 2, the 9 expected errors above; valid-usage file clean
$ lint probe (copy of fixtures/project + probe files, outside the package):
  core/engine/probe-reexport.ts         [boundaries/dependencies]   ok
  core/engine/probe-dynamic.ts          [boundaries/dependencies]   ok
  core/engine/probe-type-only.ts        [boundaries/dependencies]   ok
  convex/nested/probe-convex-react.ts   [no-restricted-imports]     ok
  core/engine/probe-node-builtin.ts     []                          r03
  core/engine/probe-outside-element.ts  []                          r02
  core/engine/probe-local-react-name.ts [no-restricted-imports]     r05 (false positive)
$ resolveLayout duplicates -> all three accepted                     r06
$ convex-ops dry-run with .env prod key -> Target: dev ... exit=0   r01
```

All probes live in `scratchpad/review-dev-tooling/`. The reviewer made no changes inside the package except adding this file.
