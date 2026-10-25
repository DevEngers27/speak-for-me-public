# @speak-for-me/dev-tooling

Repository guard rails for the Speak for Me rebuild. The package has no domain logic, and it does not depend on the final table, state or function design:

1. **Lint boundaries**: an ESLint 9 flat-config factory that enforces dependency direction between layers (engine <- scenarios <- convex/app). It ships with must-fail and must-pass fixture projects.
2. **Ops scripts**:
   - `check-env` reports which environment variables are present. It never prints their values.
   - `convex-ops` is a guarded `npx convex run` wrapper for seed and reset operations. It has an explicit `--yes` guard and a deployment-type allowlist.
3. **CI template**: a GitHub Actions workflow generator plus the rendered `templates/ci.yml`, which runs lint, typecheck, test and build. It needs no secrets.

Requires Node 24 and runs on Node's built-in TypeScript type stripping with no build step. All sources use erasable TypeScript syntax only, and relative imports carry `.ts` extensions.

## Layout and rules

The default layout matches the layout that the repository skeleton spike verified. Every folder can be overridden, because the final directory structure is still being designed (`BoundaryLayout`, `src/eslint/layout.ts`):

| Element | Default folder | May import |
| --- | --- | --- |
| `engine` | `core/engine` | engine |
| `scenario` (one per child folder) | `core/scenarios/<name>` | engine, its own folder |
| `convex` | `convex` | engine, scenarios, convex, convex-generated |
| `convex-generated` | `convex/_generated` | convex |
| `app` | `src` | app, engine, scenarios, convex-generated (never other convex files) |

Two mechanisms enforce these rules, each covering what the other cannot:

- **`boundaries/dependencies`** (eslint-plugin-boundaries) classifies the *resolved* target of every local import, whether relative (`../src/app/page`) or aliased (`@core/...`, `@convex/...`). It resolves aliases through `eslint-import-resolver-typescript` using the root tsconfig and `convex/tsconfig.json`. Its default is `disallow`, so anything not in the table fails, including one scenario importing another. Imports inside a single element are internal and are not checked.
- **`no-restricted-imports`** (ESLint core) bans *specifiers*:
  - Engine and scenarios: `react`, `react-dom`, `next`, `@clerk/*`, `server-only`, `client-only`, `convex/server`, `convex/react`, `convex/react-clerk`, `convex/nextjs` and `convex/browser`. `convex/values` stays allowed.
  - convex/: React, Next and Clerk.
  - All three layers: the app alias (`@/`).

  The specifier rule is what catches `@/` inside `convex/`. `convex/tsconfig.json` does not declare that alias, so the import does not resolve, and a resolver-based rule never sees it (fixture `convex/imports-app-alias.fail.ts`).

## API

```ts
import { createBoundaryConfig, DEFAULT_LAYOUT, lintFixtureProject } from "@speak-for-me/dev-tooling/eslint";

createBoundaryConfig({
  rootDir: import.meta.dirname,        // absolute repo root (required)
  layout: { app: "apps/web/src" },     // Partial<BoundaryLayout>
  tsconfigs: ["tsconfig.json", "convex/tsconfig.json"], // default
  frameworkModules: [...],             // replaces the engine/scenario ban list
  convexForbiddenModules: [...],       // replaces the convex/ ban list
}): Linter.Config[]                    // 4 named blocks: sfm/boundaries/*
```

- `lintFixtureProject({ projectDir, ...options })` lints a fixture project with only the boundary config. It returns one `FixtureResult` per file. In a fixture project, a file named `*.fail.*` must declare `// @expect-rules <ruleId...>` and produce exactly those rules. Every other file must lint clean.
- `checkEnv(spec, env)` returns `{ entries, missingRequired, exposureWarnings, ok }`. Each status is `set | missing | remote`, and values are never included. `remote` means a Convex-deployment variable, which can only be checked with `npx convex env list`. An exposure warning flags a `NEXT_PUBLIC_*` variable that is set and whose name looks like a secret. `DEFAULT_ENV_SPEC` lists the platform variables from the platform constraints.
- `resolveDeploymentTarget(env)` works out which deployment `npx convex run` would hit, using the same variables the Convex 1.48 CLI reads:
  - `CONVEX_DEPLOY_KEY`: only the prefix before `|` is inspected.
  - `CONVEX_DEPLOYMENT`.
  - `CONVEX_SELF_HOSTED_URL`.

  It fails closed on project keys, preview deploy keys, `CONVEX_DEPLOYMENT_TOKEN`, unknown formats, and selections from more than one source.
- `parseOpsConfig(json)` and `planOperation(config, request, env)` take the operation config and request and return a pure plan: `refused`, `needs-confirmation`, `dry-run` or `execute`.
- `renderCiWorkflow(overrides?)` returns the workflow YAML string from validated options (`DEFAULT_CI_OPTIONS`).

### CLIs

```sh
node --env-file-if-exists=.env.local <pkg>/src/scripts/check-env-cli.ts [--spec spec.json] [--allow-missing] [--json]
#   exit 0 ok | 1 missing required or exposure warning | 2 usage

node --env-file-if-exists=.env.local <pkg>/src/scripts/convex-ops-cli.ts <operation> \
     [--config convex-ops.config.json] [--args '{"k":1}'] [--dry-run] [--yes] [--confirm-deployment <name>]
#   exit 0 ok | 1 convex command failed | 2 refused/usage | 3 confirmation required

node <pkg>/src/eslint/lint-fixtures-cli.ts [projectDir]   # npm run lint:fixtures
node <pkg>/src/ci/render-cli.ts [out|-]                   # npm run ci:render
```

`--allow-missing` waives missing variables, which is useful for a credential-free CI build. It never waives exposure warnings.

## Design notes

- **No business names.** `convex-ops` does not know any Convex function. The consuming repo maps operation names to function paths in `convex-ops.config.json` (see `templates/convex-ops.config.example.json`). Each entry has to state `destructive` and `allowedDeploymentTypes` explicitly.
- **convex-ops guards, in order:**
  1. The operation must be known.
  2. The deployment selection must be unambiguous.
  3. A destructive operation is refused on `prod`. This is a hard floor that the parser and the planner both enforce, so config cannot override it.
  4. The deployment type must be in the operation's allowlist.
  5. A destructive operation requires `--confirm-deployment <name>` equal to the selected deployment's name.
  6. Without `--yes`, the CLI only prints the plan (exit 3).

  These checks are the client-side layer. Server-side tier checks inside the Convex functions are still required (see deepdives/testing-ops).
- **Fixed argv, no shell.** The command is always `npx convex run <fn> <json>`, and `--prod`, `--deployment` and `--preview-name` are never added. Deployment selection stays in the environment that the guard inspected. Function paths are validated, so a path cannot start with `-` or contain `..`.
- **Secrets.** `check-env` only ever handles names and booleans. `resolveDeploymentTarget` slices the deploy key before `|` and discards the secret half. Tests seed fabricated canary values and assert they never reach stdout, stderr or returned objects. The CLI tests run in child processes with an explicit, minimal `env`. No real environment, key or Claude API call is used anywhere.
- **CI template.** Every scalar is emitted as a JSON string, which is valid double-quoted YAML. Inputs are validated against strict patterns, so an option cannot inject keys or `${{ }}` expressions, and the workflow references no `secrets.*`.
  - The defaults mirror the skeleton spike: pnpm 11.25.0, `.node-version`, and an offline Convex codegen drift check before lint.
  - The action versions come from the original repo's workflow.
  - A test fails whenever `templates/ci.yml` drifts from the generator.
- **Why eslint-plugin-boundaries rather than only `no-restricted-imports`.** The skeleton spike used regexes on relative specifiers (`^\.{1,2}/.*src/`). Those break on folder names that merely contain `src`, and they cannot see where an alias points. Resolving the target file is exact. The ESLint-specific code is confined to `src/eslint/boundaries.ts`, and the fixtures pin the behaviour, so a plugin upgrade that changes semantics fails the tests.

## How the application repo uses it

1. Add the package as a workspace package or copy it under `tooling/`. Node does not strip types inside `node_modules`, but workspace symlinks resolve to their real path, which is outside it.
2. Merge it into `eslint.config.mjs` with `...createBoundaryConfig({ rootDir: import.meta.dirname })` (see `templates/eslint.config.example.mjs`). Add `tooling/dev-tooling/fixtures/**` to `globalIgnores`, because the fail fixtures are intentionally invalid.
3. Wire up scripts and CI:
   - Add `"env:check": "node --env-file-if-exists=.env.local tooling/dev-tooling/src/scripts/check-env-cli.ts"`.
   - Add `"ops": "node --env-file-if-exists=.env.local tooling/dev-tooling/src/scripts/convex-ops-cli.ts"`. Then run, for example, `pnpm ops seed --yes`.
   - Copy `templates/ci.yml` to `.github/workflows/ci.yml`, or render it with custom options.
4. As the engine and scenario packages appear, their imports are checked automatically. Adding a second scenario folder needs no config change, because isolation applies to every child folder of `layout.scenarios`.

## Dependencies

| Package | Kind | Why |
| --- | --- | --- |
| `eslint-plugin-boundaries@7.2.0` | runtime | Classifies resolved import targets into layers and enforces policies. Pinned to 7.2.0 because 7.3.0 is one day old. |
| `eslint-import-resolver-typescript@4.4.5` | runtime | Resolves `@/`, `@core/*` and `@convex/*` through tsconfig `paths` for the boundaries rule. |
| `@typescript-eslint/parser@8.71.1` | runtime | Parses TS/TSX. No type information is needed, so linting stays fast. |
| `eslint@9.39.5` | peer `^9.39` + dev | The host linter, the same version the skeleton spike used. Tests use its Node API. |
| `typescript@6.0.3` | dev | Typecheck. Same as the skeleton, and inside typescript-eslint's supported range (<6.1). |
| `vitest@5.0.5` | dev | Test runner, same as the skeleton. |
| `@types/node@24.19.2` | dev | Node 24 types. |
| `yaml@2.9.1` | dev | Tests parse the generated workflow to assert its structure. The generator itself needs no YAML library. |
| `overrides.handlebars@4.7.10` | override | boundaries 7.2.0 pins handlebars 4.7.9, which has critical advisories (GHSA-xw65-4hp5-5hc7 and others). With the override, `npm audit` reports 0 vulnerabilities. |

## Verification

Run on Node v24.21.0 / npm 11.19.0. The scratchpad path is shortened to `<scratchpad>`.

```
$ npm run typecheck
> @speak-for-me/dev-tooling@0.0.0 typecheck
> tsc --noEmit -p tsconfig.json
exit=0

$ npm test
> @speak-for-me/dev-tooling@0.0.0 test
> vitest run
 RUN  v5.0.5 <scratchpad>/foundation/dev-tooling
 Test Files  4 passed (4)
      Tests  104 passed (104)
   Start at  04:34:47
   Duration  637ms (tests 71%, import 19%, transform 9%, worker 1%)
exit=0

$ npm run lint:fixtures
> @speak-for-me/dev-tooling@0.0.0 lint:fixtures
> node src/eslint/lint-fixtures-cli.ts
ok   must-pass convex/_generated/api.ts  clean
ok   must-pass convex/_generated/server.ts  clean
ok   must-pass convex/functions.ts  clean
ok   must-fail convex/imports-app-alias.fail.ts  expected [no-restricted-imports] got [no-restricted-imports]
ok   must-fail convex/imports-app-relative.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-fail convex/imports-react.fail.ts  expected [no-restricted-imports] got [no-restricted-imports]
ok   must-pass convex/nested/uses-sibling.ts  clean
ok   must-fail core/engine/imports-convex-relative.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-fail core/engine/imports-convex-server.fail.ts  expected [no-restricted-imports] got [no-restricted-imports]
ok   must-fail core/engine/imports-react.fail.ts  expected [no-restricted-imports] got [no-restricted-imports]
ok   must-fail core/engine/imports-scenario.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-pass core/engine/index.ts  clean
ok   must-pass core/engine/relative-sibling.ts  clean
ok   must-pass core/scenarios/alpha/helper.ts  clean
ok   must-fail core/scenarios/alpha/imports-app-alias.fail.ts  expected [boundaries/dependencies, no-restricted-imports] got [boundaries/dependencies, no-restricted-imports]
ok   must-fail core/scenarios/alpha/imports-other-scenario-alias.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-fail core/scenarios/alpha/imports-other-scenario.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-pass core/scenarios/alpha/index.ts  clean
ok   must-fail core/scenarios/beta/imports-convex.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-fail core/scenarios/beta/imports-next.fail.ts  expected [no-restricted-imports] got [no-restricted-imports]
ok   must-pass core/scenarios/beta/index.ts  clean
ok   must-fail src/app/imports-convex-internal.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-fail src/app/imports-convex-relative.fail.ts  expected [boundaries/dependencies] got [boundaries/dependencies]
ok   must-pass src/app/page.tsx  clean
ok   must-pass src/lib/config.ts  clean
25 fixture files, 0 mismatched
exit=0
```

Test files:
- `test/boundaries.test.ts`: 40 tests, covering both fixture projects, layout validation and a plain-Node CLI run.
- `test/check-env.test.ts`: 13 tests.
- `test/convex-ops.test.ts`: 37 tests.
- `test/ci-workflow.test.ts`: 14 tests.

`npm audit`: found 0 vulnerabilities.
