# TypeScript 7 and monorepo tooling: oxlint, Turborepo, then one TypeScript

**Date:** 2026-10-17 (revised the same day, after the user asked to go beyond "keep Nx")
**Status:** Decided. See "Final decisions". Each stage is a separate PR in one stack.
**Ticket:** T7
**Branch:** `spike/ts7-monorepo-tooling` (PR #80), rebased on `df4a553ef`

## Problem

TypeScript 7 (the native Go port, `typescript@7.0.2`) has no JavaScript
compiler API. Its main export is `{ version, versionMajorMinor }`:
`require("typescript7").createSourceFile` and `.readConfigFile` are
`undefined`, which I checked on this branch. Every tool that calls the API
breaks when it gets 7. Earlier I recommended keeping Nx and running two
TypeScripts. The user wants to go further: drop Nx and find a lint path
without typescript-eslint, so that TS 7 can become the only TypeScript.

This spec answers two questions:

- **(A)** Is typescript-eslint needed at all, and which linter replaces it?
- **(B)** What is the concrete Nx → Turborepo plan?

It ends with a feasibility check for "TS 7 only".

Stages:

| Stage | PR                                      | Content                                                                   |
| ----- | --------------------------------------- | ------------------------------------------------------------------------- |
| 1     | #80 (this, draft)                       | This spec, plus the dual-TS type-check prototype (TS 7 runs `type-check`) |
| 2     | `chore/nx-to-turborepo`, stacked on #80 | Plan (B), implemented and verified                                        |
| 3     | later                                   | Lint migration per (A): ESLint → oxlint                                   |
| 4     | later                                   | TS 7 as the only TypeScript (see "Stage 4 feasibility")                   |

## (A) Is typescript-eslint needed at all?

### What we lint with today

These are the effective rules from `eslint --print-config` on
`apps/web/src/router.tsx`, `packages/backend/convex/schema.ts` and
`packages/domain/src/index.ts`. Config files:

- root `eslint.config.mjs`
- `packages/{backend,contracts,domain,gateway}/eslint.config.mjs`
- `apps/web` and `packages/email` have no config of their own and use the root one.

There are **89 distinct active rules**:

| Source                                      | Active rules                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Comes in via                                                                                                                                               |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@typescript-eslint/*` (20)                 | ban-ts-comment, no-array-constructor, no-duplicate-enum-values, no-empty-object-type, no-explicit-any, no-extra-non-null-assertion, no-misused-new, no-namespace, no-non-null-asserted-optional-chain, no-require-imports, no-this-alias, no-unnecessary-type-constraint, no-unsafe-declaration-merging, no-unsafe-function-type, no-unused-expressions, no-unused-vars (options set in root config), no-wrapper-object-types, prefer-as-const, prefer-namespace-keyword, triple-slash-reference | `eslint-config-next/typescript` → `typescript-eslint@8.61.0`                                                                                               |
| `react-hooks/*` (17)                        | rules-of-hooks, exhaustive-deps, and the React Compiler rules: component-hook-factories, config, error-boundaries, gating, globals, immutability, incompatible-library, preserve-manual-memoization, purity, refs, set-state-in-effect, set-state-in-render, static-components, unsupported-syntax, use-memo                                                                                                                                                                                     | `eslint-config-next` → `eslint-plugin-react-hooks`, **pinned to 7.0.1** by a `pnpm-workspace.yaml` override (7.1.1 flags existing setState-in-effect code) |
| `react/*` (17)                              | display-name, jsx-key, jsx-no-comment-textnodes, jsx-no-duplicate-props, jsx-no-undef, jsx-uses-react, jsx-uses-vars, no-children-prop, no-danger-with-children, no-deprecated, no-direct-mutation-state, no-find-dom-node, no-is-mounted, no-render-return-value, no-string-refs, no-unescaped-entities, require-render-return                                                                                                                                                                  | `eslint-config-next`                                                                                                                                       |
| `@next/next/*` (20 + 2 non-web)             | google-font-*, inline-script-id, no-img-element (18 warnings today), no-head-element / no-html-link-for-pages (off for `apps/web`), …                                                                                                                                                                                                                                                                                                                                                            | `eslint-config-next`. Mostly irrelevant: the app is TanStack Start, not Next.js                                                                            |
| `jsx-a11y/*` (6), `import/*` (1), core (5)  | alt-text, aria-_, role-_; import/no-anonymous-default-export; no-var, prefer-const, prefer-rest-params, prefer-spread, no-restricted-imports (web: no direct `_generated` imports)                                                                                                                                                                                                                                                                                                               | `eslint-config-next` + root config                                                                                                                         |
| `@nx/enforce-module-boundaries` (1)         | the hexagonal tag policies                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | root config (+ a backend override)                                                                                                                         |
| `@nx/dependency-checks` (on `package.json`) | declared deps vs imports                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | the 4 per-package configs                                                                                                                                  |

- **Type-aware rules: none.** No config sets `parserOptions.project` or
  `projectService`. `.ts(x)` files are parsed by `@typescript-eslint/parser`
  (`typescript-eslint/parser@8.61.0`), and `.js` files by next's Babel parser.
- So the typescript-eslint dependency is **only the parser plus 20 syntactic
  rules**. The parser still needs the TS 6 API (`typescript-estree` calls
  `ts.createSourceFile`), and the plugin's dist `require("typescript")` in 72
  files.
- `react-hooks` 7.x parses with its own Babel/Hermes. Its compiler rules don't
  depend on the TS parser.
- `@nx/enforce-module-boundaries` needs Nx's project graph.
- There are no custom rules.
- Baseline result: **0 errors, 30 warnings** (18 `no-img-element`, 12
  `no-unused-vars`).

### ESLint without typescript-eslint: not viable

- ESLint's default parser (espree) can't parse TypeScript. On
  `packages/domain/src/index.ts` it gives `Parsing error: Unexpected token
type` (checked).
- `@babel/eslint-parser` with the TS preset could parse it, but the 20
  `@typescript-eslint/*` rules ship in a plugin that requires `typescript` at
  load time. `eslint-config-next/typescript` also always pulls typescript-eslint
  in.
- So "ESLint, no typescript-eslint" means losing those 20 rules and
  hand-assembling a Babel config. It saves nothing over switching linters.

### Candidates measured on this repo

Lint wall time over `apps/web/src` + `packages/*`. Medians of 3, local Ryzen
7 9800X3D. Background load (other agents) was high during some runs; the
spread is in brackets.

| Setup                                                                                | Wall time (ms)                | Result vs ESLint baseline                                                                                                             |
| ------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **ESLint today** via `nx run-many -t lint --parallel=4 --skip-nx-cache`              | **11453** [14602 11453 10793] | 0 errors / 30 warnings                                                                                                                |
| ESLint today, one serial `eslint apps/web/src packages/…`                            | 14067 [14067 14236 13971]     | same                                                                                                                                  |
| oxlint 1.88.0 native, rules mapped 1:1 (incl. oxlint's own React Compiler rules)     | **163** [198 163 160]         | 30 identical + 2 extra a11y warnings, **+11 errors** (9 `set-state-in-effect`, 2 `purity`)                                            |
| oxlint native + `eslint-plugin-boundaries` as jsPlugin                               | 1405 [1405 1400 1410]         | as above; boundaries clean                                                                                                            |
| oxlint + `eslint-plugin-react-hooks@7.0.1` as jsPlugin (native compiler rules off)   | 5842 [5846 5801 5842]         | **exact parity**: same 30 locations, plus 2 extra `jsx-a11y/role-has-required-aria-props` warnings (combobox without `aria-controls`) |
| oxlint + react-hooks 7.0.1 + boundaries, both as jsPlugins                           | **7310** [7335 7296 7310]     | as above; boundaries clean, and an illegal import is caught                                                                           |
| oxlint + `eslint-plugin-react-hooks@7.1.1` as jsPlugin                               | 4471 [4548 4471 4365]         | +15 errors (10 set-state-in-effect, 5 refs), which is why 7.0.1 is pinned                                                             |
| oxlint `--type-aware` (oxlint-tsgolint 7.0.2004) + `typescript/no-floating-promises` | 1356 [1462 1356 1356]         | works on TS 7 (tsgolint builds programs with typescript-go); 23 new floating-promise findings                                         |
| Biome 2.5.15, `biome migrate eslint` output                                          | 141 [161 141 138]             | **15 errors / 79 warnings**: different rule semantics; see below                                                                      |

Notes on the runs:

- The tools were installed in a scratch directory, not committed.
- oxlint skipped every file while the worktree sat under the main repo's
  gitignored `.claude/worktrees/`. Explicit paths worked. CI checkouts are
  unaffected.

### Rule parity per candidate

**oxlint 1.88 (native)** covers 81 of the 89 rules. It has its own ports of the
React Compiler rules: `react/purity`, `react/refs`, `react/set-state-in-effect`
and so on. They are **stricter than the pinned 7.0.1**: they flag the same
setState-in-effect code that 7.1.1 flags, plus `new Date()` in render
(`footer.tsx:58`, `completions/index.tsx:176`).

| Lost with oxlint native                                    | With jsPlugins                                    | Impact                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------- |
| `@nx/enforce-module-boundaries`                            | ✅ `eslint-plugin-boundaries` jsPlugin (verified) | see "Module boundaries" below                                             |
| `react-hooks/component-hook-factories`, `config`, `gating` | ✅ react-hooks jsPlugin                           | none                                                                      |
| `react/jsx-uses-react`, `react/jsx-uses-vars`              | obsolete                                          | none. oxlint's `no-unused-vars` already counts JSX usage                  |
| `react/no-deprecated`                                      | ❌                                                | low. React 19 already removed most of the APIs it flags                   |
| `@next/next/no-location-assign-relative-destination`       | ❌                                                | none. A Next.js-only rule, and the app isn't Next                         |
| `@nx/dependency-checks` (package.json)                     | ❌ (oxlint doesn't lint JSON)                     | low. An undeclared workspace import already fails `tsc` (TS2307, checked) |

- **Maturity:**
  - oxlint core is 1.x stable.
  - JS plugins are **alpha** ("currently in alpha, and remain under active
    development" per oxc.rs docs). They worked unmodified for both plugins here.
  - Type-aware linting is through `oxlint-tsgolint`, which runs on
    typescript-go, so it is **TS-7-native**. It supports 59 of 61 typescript-eslint
    type-aware rules. We use none today, so this is an upside, not a
    requirement.
- **TS 7 compatibility:** oxlint parses TS natively (oxc) and needs no
  `typescript` package. The jsPlugins don't need it either.

**Biome 2.5.15.**

- `biome migrate eslint` maps **48 of the 87** rules active for `apps/web`.
- Unsupported, "not yet implemented":
  - 14 of the 15 React Compiler rules (only `component-hook-factories` maps,
    to a nursery rule)
  - 11 `react/*` rules, including `display-name`, `jsx-no-undef` and
    `no-unescaped-entities`
  - `import/no-anonymous-default-export`
  - `@typescript-eslint/no-unused-expressions`, `triple-slash-reference`
- Unknown to Biome: `@nx/enforce-module-boundaries` and 10 `@next/next/*` rules.
- Biome has no ESLint-plugin runtime. Its GritQL plugins match syntax patterns,
  so they can't run react-hooks' compiler analysis or resolve imports into
  packages. Boundaries would have to move to dependency-cruiser.
- Its results also diverge: 15 errors and 79 warnings, versus 0 and 30. It
  reports 34 `useExhaustiveDependencies` findings that ESLint doesn't, and 4
  `noExplicitAny`.
- Biome has its own type inference, not a TypeScript program, so it's
  TS-7-neutral.
- **Not viable without losing the React Compiler rules**, and the repo's
  lint-guard notes treat those as errors.

### Module boundaries without Nx

- **`eslint-plugin-boundaries@7.2.0`**. One element per package, with the same
  5 type policies as the Nx tags (`!(allowed|types)` negation). It is verified
  in stage 2 under ESLint: web → `@jigswap/domain`, web → relative
  `../../../packages/domain/src` and domain → `@jigswap/gateway` all fail, and
  the repo is clean.
- **Under oxlint as a jsPlugin**:
  - It catches violations through relative paths and through declared
    workspace deps (verified with a temporary web → gateway prohibition).
  - It can't classify an import of a package the importer doesn't declare
    (no `node_modules` link). That import already fails `tsc` with TS2307
    (verified).
- **What Nx did that boundaries doesn't:**
  - It flagged relative imports into an _allowed_ package
    ("Projects cannot be imported by a relative or absolute path").
  - It flagged cross-project cycles.
  - dependency-cruiser's `no-circular` can cover cycles if wanted.
- **dependency-cruiser** (`.dependency-cruiser.cjs`, `arch:check`) keeps its
  current job: domain purity (no Convex/Clerk/React/zod, no sibling packages).
  It could take over package boundaries too, but it runs as a separate task and
  its TS parsing (`tsPreCompilationDeps`) uses the TS 6 API (see stage 4).

### Recommendation (A): oxlint, no ESLint

Replace ESLint, typescript-eslint, `eslint-config-next` and the `next`
devDependency with oxlint:

- an `.oxlintrc.json` mapping the 81 native rules
- the `boundaries` jsPlugin for the hexagonal policies
- the `react-hooks` jsPlugin pinned to 7.0.1, for exact compiler-rule parity

That gives the same findings in about 7.3 s instead of about 11–14 s. No
residual ESLint is needed.

Then, as a follow-up, fix or annotate the 11 findings from oxlint's native
compiler rules and drop the react-hooks jsPlugin. That brings lint to about
1.4 s and removes the alpha dependency for that part.

This takes typescript-eslint out of the tree entirely, which is what stage 4
needs. Biome is rejected (no React Compiler rules, no boundary story). ESLint
without typescript-eslint is not viable.

## (B) Turborepo plan

This is what stage 2 implements; its PR carries the details and measurements.

- **`turbo.json` tasks:**
  - `build`: `dependsOn ^build`, outputs `.output/**` and `dist/**`, env `VITE_*`.
  - `@jigswap/web#build`: also takes `$TURBO_ROOT$/docs/user/**` as input,
    like the old Nx input.
  - `lint`: inputs + `$TURBO_ROOT$/eslint.config.mjs`.
  - `type-check`: inputs + `tsconfig.base.json`.
  - `test`: cached.
  - `coverage`: `cache: false`, as under Nx. Its reports live outside the
    package, in `coverage/packages/*`.
  - `//#arch:check`: a root task over `.dependency-cruiser.cjs` and
    `packages/domain/src`.
  - `mutation`: `cache: false`.
  - `dev` and `start`: `cache: false`, `persistent`.
  - `cacheDir: ".turbo/cache"` is set explicitly. Otherwise turbo shares one
    cache across git worktrees, and outputs contain absolute paths.
  - `agentGuidance: false`. Otherwise turbo writes an `AGENTS.md` when it
    detects an agent.
- **Package scripts are the source of truth.** Each package gets
  `lint`/`coverage`/`dev` where Nx used to infer them. Root scripts become
  `turbo run …`: `affected` → `--affected`, `graph` → `--graph=graph.html`.
- **Removed:**
  - `nx.json`, `.nxignore`, all 6 `project.json`, the 4 per-package
    `eslint.config.mjs` (they only held `@nx/*` rules)
  - `@nx/*`, `nx`, `@swc-node/*`, `@swc/core`, `@swc/helpers`,
    `jsonc-eslint-parser`
  - the `nx` build-allow entries in `pnpm-workspace.yaml`
  - the `@nx/vite` `nxViteTsPaths`/`nxCopyAssetsPlugin` in 4 vite configs.
    They were no-ops: `tsconfig.base.json` has no `paths`.
  - `node_modules/.pnpm` shrinks from 1.3 GB to 912 MB.
- **Surprise: `next` is not dead weight yet.** `eslint-config-next` loads
  `next/dist/compiled/babel/eslint-parser`, and `@nx/next` was the only thing
  providing `next`. Stage 2 adds `next@16.2.7` (the version that was resolved
  before) as an explicit devDependency. Stage 3 removes it together with
  `eslint-config-next`.
- **CI:**
  - `ci.yml`: gate becomes
    `turbo run lint type-check test build arch:check --concurrency=4`, and
    `actions/cache` caches `.turbo/cache`.
  - `mutation.yml`: `turbo run mutation --filter=@jigswap/domain`.
  - `reports.yml`: `turbo run coverage --concurrency=2`. ANALYZE still uses
    plain `vite build`.
  - The `convex-*.yml` and `pages-maintenance.yml` workflows don't use Nx.
- **`scripts/vercel-build.sh`**: unchanged. It never used Nx (`pnpm build`
  in `apps/web`, `pnpm --filter @jigswap/web build`).
- **Docs:** README, CONTRIBUTING, `docs/developer-guide.md`,
  `packages/backend/README.md`, `packages/domain/MUTATION-TESTING.md`.
  `CLAUDE.md` has no Nx references. Historical plan docs under
  `docs/superpowers/plans` keep theirs.
- **Agent memory notes that go stale:**
  - `ci-verify-mirror` (`--skip-nx-cache` → `turbo … --force` or
    `rm -rf .turbo`)
  - `jigswap-tooling-gotchas` ("backend nx target is `coverage`": there is now
    a `test` script)
  - the backend-tests line in the conventions file
  - The user should update these. This spec doesn't edit them.
- **Gaps:**
  - **Fixed: web type-check race.**
    - `src/routeTree.gen.ts` is gitignored and only written by the Start
      plugin. Under Nx, web type-check passed only because the concurrent build
      wrote it first. On a clean checkout turbo exposed about 80 errors.
    - The `type-check` script now runs `generate-route-tree.mjs` first. It
      resolves the Vite config, takes 0.5 s, and produces byte-identical
      output to `vite build`.
  - **Fixed: backend type-check covered 0 files.**
    - `tsconfig.json` now extends `convex/tsconfig.json` and covers 828 files,
      excluding `*.test.ts`.
    - The 3 errors this surfaced (`Object.hasOwn`, `Array#at`, which aren't in
      Convex's required ES2021 lib) are rewritten to ES2021 equivalents.
    - Related finding: Convex's deploy-time typecheck has been **silently
      skipped**. It looks for `packages/backend/node_modules/typescript`, which
      doesn't exist ("No `tsc` binary found, so skipping typecheck").
  - **Fixed: the backend had no `test` script.** Its 860 tests now run in the
    gate (+about 8 s of CPU).
  - **Surfaced, not fixed:** the ~199 type errors in `convex/*.test.ts`.
    These are mostly `import.meta.glob` typing and loose `Doc` unions. It's
    not cheap, and is better as its own PR.

## Stage 4 feasibility: TS 7 as the only TypeScript

Every package that reaches for the TS API, checked on this branch. The method
was to grep for `require/import("typescript")` in the installed dist code, plus
the `typescript` dep or peer declarations:

| Consumer                                                                                        | Uses TS API?                                                                                           | Under TS 7 only                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nx (`nx`, `@nx/js`, `@swc-node/register`)                                                       | yes                                                                                                    | gone after stage 2                                                                                                                                                 |
| typescript-eslint, `eslint-config-next`, `ts-api-utils`                                         | yes (parser + plugin)                                                                                  | gone after stage 3 (oxlint)                                                                                                                                        |
| **prettier-plugin-organize-imports**                                                            | **yes: TS language service** (5 files). `format:check` runs it.                                        | **blocker.** Replace it, e.g. oxlint `sort-imports` + `no-unused-vars` autofix, or a Babel-based import sorter; or keep an aliased TS 6 just for it                |
| **dependency-cruiser** (`arch:check`)                                                           | yes, when `tsPreCompilationDeps: true` (`extract/tsc/*`)                                               | **needs a config change**: set `parser: "swc"` (`@swc/core` is still in the tree via webpack/terser), which loses type-only-import detection; or keep TS 6 aliased |
| **Stryker** core `ts-config-preprocessor`                                                       | yes: `ts.parseConfigFileTextToJson` on the sandbox's `tsconfig.json` unless `inPlace`                  | **needs `inPlace: true`** in both stryker configs, or a TS 6 alias. Not tested                                                                                     |
| Convex CLI (deploy typecheck, codegen, bundling)                                                | no API. It spawns `node_modules/typescript/bin/tsc --project convex --listFiles`. Bundling is esbuild. | works. TS 7's `tsc --project convex --listFiles` lists 1719 files fine. Add `typescript` to `packages/backend` devDeps so the typecheck stops being skipped        |
| vite, `@tanstack/router-plugin`, `start-plugin-core`, `router-generator`, `vite-tsconfig-paths` | no                                                                                                     | works                                                                                                                                                              |
| `tsconfck` (via vite-tsconfig-paths)                                                            | only for optional `parseNative`                                                                        | works (not used)                                                                                                                                                   |
| vitest, `@vitest/coverage-v8`, convex-test                                                      | no (oxc/esbuild transforms)                                                                            | works                                                                                                                                                              |
| `convex-helpers` / `frimousse`                                                                  | optional peer, types only (`convex-helpers` peer already allows `^7`)                                  | works                                                                                                                                                              |
| `@types/*`                                                                                      | declaration files only                                                                                 | works. All 6 projects type-check clean under TS 7 today                                                                                                            |
| Editors                                                                                         | VS Code's built-in TS uses `tsserver.js`, which TS 7 doesn't ship                                      | needs the TS 7 native language-server extension. A DX change, not a CI blocker                                                                                     |

**Verdict:** stage 4 is feasible after stages 2 and 3, with three small,
independent changes:

- replace prettier-plugin-organize-imports
- switch dependency-cruiser to the swc parser (or accept losing
  type-only-import detection)
- run Stryker `inPlace`

None of the three is a compiler-API dependency we can't remove.

## Final decisions (user, 2026-10-17)

The user decided after reading the analysis above. Where this section and the
earlier sections differ, this section wins.

### Lint: oxlint, ESLint dropped entirely

- **oxlint native rules** for everything oxlint implements: 81 of today's 89
  active rules, mapped 1:1.
- **jsPlugins:**
  - `eslint-plugin-react-hooks`, for the React Compiler rules oxlint lacks
    natively (`component-hook-factories`, `config`, `gating`) and for exact
    parity with today's findings
  - `eslint-plugin-boundaries`, for the hexagonal package policies
- **`oxlint-tsgolint`** for type-aware linting. It runs on typescript-go, so
  it's TS-7-native. Today we have zero type-aware rules. The stage-3 PR picks
  the initial set and fixes or justifies its findings (for example,
  `no-floating-promises` currently has 23).
- **Out:** ESLint, typescript-eslint, `eslint-config-next`, and the `next`
  devDependency stage 2 had to add.
- **The 3 rules we lose.** Each is listed here and in the stage-3 PR:
  1. `react/no-deprecated`. oxlint has no port. Low impact: React 19
     removed most of the APIs it flags.
  2. `@next/next/no-location-assign-relative-destination`. A Next.js-only
     rule, and the app is TanStack Start.
  3. `@nx/dependency-checks` (declared deps vs imports in `package.json`).
     oxlint doesn't lint JSON. An undeclared workspace import still fails
     `tsc` with TS2307.
  - Not counted as losses: `react/jsx-uses-react` and `react/jsx-uses-vars`.
    oxlint's `no-unused-vars` already counts JSX usage.

### Stack order and why

1. **#80, this spec.** Records the decisions; the dual-TS type-check stays until stage 6.
2. **Nx → Turborepo.** Removes Nx's TS-API dependency (`readConfigFile`,
   `@nx/js`, `@swc-node/register`). It goes first because the oxlint migration
   replaces `@nx/enforce-module-boundaries`, which must already work without
   Nx (`eslint-plugin-boundaries`). It also fixes the web route-tree race, the
   0-file backend type-check and the missing backend `test` gate.
3. **oxlint.** Removes typescript-eslint, the other hard TS 6 consumer.
   Moves boundaries to an oxlint jsPlugin.
4. **Convex type errors + CI gate.** Fixes the ~199 errors in
   `convex/*.test.ts` with real types: no blanket `any`, no `@ts-expect-error`.
   Then `convex/tsconfig.json` (tests included) type-checks clean, and the
   gate type-checks it. This comes before TS 7 so the compiler swap isn't mixed
   with error fixes, and before stage 5 so the deploy typecheck has a clean
   tree to enforce.
5. **Convex deploy typecheck runs and gates.**
   - `packages/backend` gets its own `typescript` devDependency, so
     `convex deploy` finds `node_modules/typescript/bin/tsc`.
   - Deploys pass `--typecheck=enable` (or equivalent) in
     `.github/workflows/convex-deploy.yml` and `scripts/vercel-build.sh`, so a
     type error fails the deploy.
   - The PR must prove the typecheck actually runs, from the CLI's own
     output.
6. **TS 7 as the only TypeScript.**
   - Rename `typescript7` back to `typescript@7` and drop the explicit-path
     scripts.
   - The 3 tool swaps from "Stage 4 feasibility":
     - replace `prettier-plugin-organize-imports`
     - dependency-cruiser `parser: "swc"`
     - Stryker `inPlace: true`
   - Last, because every earlier stage removes a TS 6 consumer.

### Scoped TS 6 contingency

TS 7 becomes the only version. The one exception: if the Convex CLI's
typecheck (stage 5) truly needs the TS 6 compiler API, rather than just
spawning `bin/tsc`, keep a TS 6 scoped to `packages/backend` only. That would
be its own `typescript@6` devDependency there, with the root and every other
package on 7.

Current evidence says this won't be needed. The CLI spawns
`node_modules/typescript/bin/tsc --project convex --listFiles` with no API use,
and TS 7's `tsc` handles those flags (it listed 1719 files). Stage 5 confirms
or refutes this. Stage 6 records the outcome.

## Why the dual-TS prototype commit stays on this branch

`chore(tooling): type-check with TypeScript 7 alongside TypeScript 6` stays.
Until stage 3 removes typescript-eslint and stage 4 handles the three
consumers above, `typescript@6.0.3` must stay the `typescript` package for its
API consumers. `typescript7` (`npm:typescript@7.0.2`) runs the `type-check`
scripts, by explicit path, because both packages ship a `tsc` bin.

Measured on the earlier base (`b9fd1550f`), medians of 3:

| Project / run                                                        | TS 6.0.3 (ms) | TS 7.0.2 (ms) |
| -------------------------------------------------------------------- | ------------- | ------------- |
| `apps/web`                                                           | 7241          | 1275          |
| `packages/gateway`                                                   | 2814          | 604           |
| `packages/domain`                                                    | 983           | 112           |
| `packages/email`                                                     | 719           | 86            |
| `packages/contracts`                                                 | 255           | 41            |
| `packages/backend/convex/tsconfig.json`                              | 3693          | 660           |
| `nx run-many -t type-check --parallel=4 --skip-nx-cache`, end to end | 8642          | 1915          |

Stage 4 collapses this back to a single `typescript@7` and removes the alias
and the explicit paths.

## Not determined

- oxlint jsPlugins are alpha. Stage 3 should pin oxlint exactly and keep the
  parity check (the same 30 findings) in its PR.
- Whether Nx 24 (beta) drops its TS-API dependency. Moot after stage 2.
- typescript-eslint's TS 7 timeline. No `9.x` or TS-7-peer canary is published.
  Moot after stage 3.
- Runtimes on GitHub runners. All numbers here are local, and some ran under
  load from parallel agents.
