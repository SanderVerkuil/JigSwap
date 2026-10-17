# TypeScript 7 and monorepo tooling: keep Nx, run two TypeScripts

**Date:** 2026-10-17
**Status:** Proposed (spike; the user decides)
**Ticket:** T7
**Prototype:** on this branch (`spike/ts7-monorepo-tooling`), option (a) only

## Problem

PR #71 held `typescript` at `6.0.3`. TypeScript 7 (the native Go port) is
now stable, but it ships no JavaScript compiler API. The `typescript@7.0.2`
package's main export (`.`) is `./lib/version.cjs`. Its only other exports
are `./unstable/*` (sync/async IPC API, AST). Anything that does
`require("typescript").readConfigFile(...)` or `createProgram(...)` breaks
when it gets 7:

- **Nx**: its project graph reads tsconfigs through `tsModule.readConfigFile`.
  The `@nx/js:tsc` executor (the backend `build` target) drives the compiler
  API.
- **typescript-eslint**: every published line still has peer
  `typescript: ">=4.8.4 <6.1.0"`.
- **vite and Convex tooling** reach for `typescript` too (Convex's CLI runs
  `node_modules/typescript/bin/tsc` for its deploy typecheck, see below).

The user asked two things: can we get TS 7, and should we drop Nx (and
would an alternative make the repo simpler)?

**The key finding: dropping Nx does not get us TS 7.** typescript-eslint is
the harder blocker, and Turborepo or plain pnpm don't touch it. It comes in
through `eslint-config-next@16.4.2 -> typescript-eslint@8.61.0`, and the
root `eslint.config.mjs` uses it. Every option has to keep `typescript@6`
installed for API consumers until typescript-eslint ships TS-7 support. So
"TS 7" and "drop Nx" are two separate decisions, and this spec treats them
separately.

## Upstream status (npm registry, queried 2026-10-17)

| Package                      | Finding                                                                                                                                                                                                                                                                     |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `typescript`                 | `latest` = `7.0.2` (published 2026-07-08), `next` = `7.1.0-dev.20261017.1`. bin: `tsc` only. Native binaries come as optional deps `@typescript/typescript-<os>-<arch>@7.0.2`.                                                                                              |
| `@typescript/native-preview` | Frozen: `latest` = `7.0.0-dev.20260707.2` (last modified 2026-07-07), bin `tsgo`. It was the pre-release channel. Don't use it now that `typescript@7` is stable.                                                                                                           |
| `typescript-eslint`          | `latest` = `8.71.2`, `canary` = `8.71.3-alpha.10`: both peer `typescript >=4.8.4 <6.1.0`. No `9.x` published. `@typescript-eslint/typescript-estree@latest` has the same peer. **Not TS-7-compatible.**                                                                     |
| `nx`                         | `latest` = `23.3.0` (ours), `next` = `24.0.0-beta.2`. Neither declares a `typescript` peer, and 24 beta pulls no `typescript` dependency. Nothing in the registry metadata says Nx 24 drops `readConfigFile`, so assume **not TS-7-compatible** until release notes say so. |

## How this repo really uses Nx (inventory)

Six projects, each with a `project.json`: `apps/web`, `packages/backend`,
`packages/contracts`, `packages/domain`, `packages/email`, `packages/gateway`.

### Task running

- **CI** (`.github/workflows/ci.yml:48`):
  `pnpm exec nx run-many -t lint type-check test build arch-check --parallel=4`
  is the single gate step, after `format:check`.
- **Root scripts** (`package.json`): `dev`, `build`, `start`, `lint`,
  `lint:fix`, `type-check`, `test`, `clean` (`nx reset`), `graph`, `affected`,
  `mutation:domain` all wrap `nx`. `arch:check` already calls `depcruise`
  directly.
- **`project.json` targets.** Almost all of them are
  `nx:run-commands` → `pnpm run <script>`, so the package scripts already do
  the real work:
  - `apps/web/project.json`: `build` (`vite build`, with an extra input
    `{workspaceRoot}/docs/user/**/*`), `dev`, `serve`, `start`, `type-check`,
    `test`, `lint` (`@nx/eslint:lint`). Tags `type:app`, `scope:web`.
  - `packages/backend/project.json`: `build` (**`@nx/js:tsc`**, `main:
packages/backend/src/index.ts`, but there is no `src/` directory, so it
    builds nothing), `dev` (`convex dev`), `type-check`, `coverage`, `deploy`.
    No `test` target, so CI never runs backend tests (convex-test).
    Tags `type:backend-adapter`, `scope:backend`.
  - `packages/contracts/project.json`: `type-check`. Tags `type:contracts`.
  - `packages/domain/project.json`: `type-check`, `test`, `coverage`,
    `arch-check` (`depcruise --config .dependency-cruiser.cjs
packages/domain/src`), `mutation` (`cache: false`). Tags `type:domain`.
  - `packages/email/project.json`: `type-check`, `test`, `coverage`,
    `mutation`. Tags `type:backend-adapter`.
  - `packages/gateway/project.json`: `type-check`. Tags `type:gateway`.
- **Inferred targets** from `nx.json` plugins (`nx show project`):
  `@nx/eslint/plugin` gives `lint` for the packages. `@nx/vite/plugin` gives
  `typecheck` (bare `tsc --noEmit -p ...`; nothing runs it, and it duplicates
  `type-check`), `build-deps`, `watch-deps`, `preview`, `serve-static`.
  `@nx/next/plugin` infers nothing (there is no `next.config.*`), but the
  `@nx/next` dependency pulls in `next@16.2.7` (167 MB in the store) and
  `sharp`. Neither is used by the app. **It is stale and can go regardless of
  this decision.**
- **Other workflows**: `.github/workflows/mutation.yml:45`
  (`nx run @jigswap/domain:mutation`) and `.github/workflows/reports.yml:42`
  (`nx run-many -t coverage --parallel=2`). `reports.yml:49` already calls
  `vite build` directly because Nx doesn't key on `ANALYZE`. The
  `convex-*.yml` and `pages-maintenance.yml` workflows don't use Nx.
- **Vercel** (`scripts/vercel-build.sh`): does **not** use Nx. Production
  runs `pnpm build` from `apps/web` (the package script `vite build`). Preview
  runs `convex deploy --cmd 'pnpm --filter @jigswap/web build'`.

### Caching

- `nx.json` `targetDefaults`: `build`, `lint`, `test`, `type-check` have
  `cache: true`. `namedInputs` has the usual `default`/`production`.
- **No Nx Cloud**: no `nxCloudId`/`accessToken` in `nx.json`, no `NX_CLOUD_*`
  in workflows.
- CI keeps the local cache in GitHub's cache (`ci.yml:35-40`,
  `actions/cache` on `.nx/cache`, key `nx-<os>-<sha>`, restore-key
  `nx-<os>-`). So CI replays unchanged projects.
- Locally the cache gets in the way as often as it helps: the team convention
  is to verify with `--skip-nx-cache` because cached replays hid fresh
  failures.

### Module boundaries

- Root `eslint.config.mjs:32-87`: `@nx/enforce-module-boundaries` with
  `depConstraints` on tags. `type:domain` → domain only. `type:contracts` →
  contracts only. `type:backend-adapter` → domain/contracts/backend-adapter.
  `type:gateway` → contracts/backend-adapter/gateway. `type:app` →
  contracts/backend-adapter/gateway/app. `scope:*` is non-restrictive. It
  also sets `enforceBuildableLibDependency: true`. **This rule needs the Nx
  project graph**, so it is the main thing Nx gives us beyond running tasks.
- Per-package `eslint.config.mjs` in `packages/{backend,contracts,domain,gateway}`:
  `@nx/dependency-checks` on `package.json` (declared deps match imports).
- `.dependency-cruiser.cjs` (`arch-check`, domain only):
  `domain-stays-framework-free` and `domain-no-sibling-packages`. This
  overlaps the `type:domain` tag rule.
- `packages/{backend,domain,email}/vite.config.ts` import
  `nxViteTsPaths` (and the backend imports `nxCopyAssetsPlugin`) from `@nx/vite`.

### Side findings (not fixed here)

- `packages/backend` `type-check` (`tsc --noEmit` on `tsconfig.json`) checks
  **zero files**: `files: []`, `include: []`, and the references point at
  `tsconfig.lib.json`/`tsconfig.spec.json`, which include a non-existent
  `src/`. The Convex code (`convex/tsconfig.json`) is type-checked by no CI
  target. It has 202 errors under both TS 6 and TS 7, 199 of them in
  `*.test.ts` (mostly `import.meta.glob` typing, plus test-only casts) and 3
  in non-test files.
- The backend `build` (`@nx/js:tsc`) is a no-op for the same reason.

## Options

### (a) Keep Nx, run two TypeScripts (recommended)

`typescript@6.0.3` stays as `typescript`, so `require("typescript")` keeps
working for Nx, typescript-eslint, vite plugins and `@nx/js:tsc`. TS 7 goes
in under an npm alias, and only the `type-check` targets call it.

- **Install, verified:** `"typescript7": "npm:typescript@7.0.2"` in root
  `devDependencies`. `pnpm install` resolves cleanly. The lockfile adds
  `typescript@7.0.2` plus its 20 optional platform packages, and no existing
  resolution changes.
- **Gotcha, verified:** both packages publish a bin named `tsc`. After the
  install, the root `node_modules/.bin/tsc` points at **TS 7**. Packages
  without their own `typescript` dep (backend, contracts, domain, email,
  gateway) then pick up TS 7 for bare `tsc`. `apps/web` keeps 6.0.3 because
  it declares `typescript` itself. Which bin wins is a pnpm link detail, not a
  contract. So the prototype calls the compiler by explicit path in every
  `type-check` script: `node ../../node_modules/typescript7/bin/tsc --noEmit`.
- **Convex:** its CLI deploy typecheck looks up
  `node_modules/typescript/bin/tsc` (or `@typescript/native/bin/tsc`) by path,
  not via `.bin`. So it keeps using 6.0.3 and nothing changes. (It also
  supports `typescriptCompiler: "tsgo"`. Not needed.)
- **What breaks:** nothing observed. Every project type-checks with 0 errors
  under both versions. On the out-of-CI Convex tsconfig, both versions report
  errors at the same 202 locations. Only 4 error codes differ (TS2345 vs
  TS2741) and some union printing differs. A deliberately wrong file fails
  `type-check` under TS 7 as expected.
- **Migration size:** 8 files (root `package.json`, 6 package `package.json`
  `type-check` scripts, `pnpm-lock.yaml`).
- **CI changes:** none. The same `run-many` line runs.
- **Caching:** unchanged.
- **Effort:** under an hour, already prototyped. **Risk:** low and reversible
  (revert one commit). The one ongoing cost is two TypeScripts. An editor
  using the workspace TS gets 6.0.3, so IDE and CI can disagree in edge cases
  until TS 7 becomes the only compiler.
- **Exit:** once typescript-eslint (and Nx) support TS 7, rename the
  dependency back to `typescript` and drop the alias and explicit paths.

### (b) Replace Nx with Turborepo + eslint-plugin-boundaries / dependency-cruiser

- **TS 7?** No help: typescript-eslint still needs `typescript@6`, so (a)'s
  two-TypeScript setup is still required.
- **What breaks / must be replaced:** `@nx/enforce-module-boundaries`
  (rewrite the 6 tag rules as `eslint-plugin-boundaries` element types keyed
  on path, or as dependency-cruiser rules; dependency-cruiser is already a
  devDep and covers domain). `@nx/dependency-checks` (4 configs; replace with
  e.g. `knip` or drop). `nxViteTsPaths`/`nxCopyAssetsPlugin` in 3 vite
  configs (replace with `vite-tsconfig-paths`, which `apps/web` already uses).
  The `@nx/js:tsc` backend build (drop, it is a no-op). The extra `inputs` for
  web's `docs/user/**` (express as turbo `inputs`).
- **Migration size:** about 25 config files. Delete 6 `project.json` +
  `nx.json`, add `turbo.json`, edit root `package.json` scripts and devDeps,
  root + 4 package eslint configs, 3 vite configs, 3 workflows
  (`ci.yml`, `mutation.yml`, `reports.yml`), README/CONTRIBUTING/
  developer-guide. Plus lockfile churn. About 35 historical plan docs mention
  `nx` (leave them).
- **CI changes:** the gate becomes
  `turbo run lint type-check test build arch-check`. Cache `.turbo` with
  `actions/cache`, or use Vercel Remote Cache (free on Vercel, which we
  already deploy to; needs a `TURBO_TOKEN`/`TURBO_TEAM` secret).
- **Caching:** about the same. Turbo hashes package-script inputs much like
  Nx. Remote cache would be new, but our CI cache already gives most of the
  benefit.
- **Effort:** 1–2 days including re-proving every boundary rule with
  negative tests. **Risk:** medium. Boundary enforcement is the easy thing to
  regress silently. Turbo's `^build` dependency model also differs from
  `dependsOn: ["^build"]` + `@nx/js:tsc`.

### (c) Plain pnpm workspaces + a boundaries tool, no task runner

- **TS 7?** Same as (b): still needs (a)'s two TypeScripts.
- **What breaks:** everything in (b), plus caching. CI would run
  `pnpm -r --parallel run lint`, `... type-check`, and so on (or one
  `pnpm -r run verify`), with no replay of unchanged projects.
- **Migration size:** as (b) minus `turbo.json`, about 24 files.
- **CI changes:** replace the `run-many` step with `pnpm -r` steps and remove
  the `.nx/cache` step.
- **Caching:** lost. Today's full uncached gate takes **14.6 s** on this
  machine (18 tasks, `--parallel=4`), and the TS 7 type-check part drops
  from about 8.6 s to about 1.9 s. On a GitHub runner it would be a few times
  slower, but the gate is not cache-dependent in practice.
- **Effort:** about 1 day. **Risk:** medium, the same boundary-regression
  risk as (b). This is the simplest end state: fewest concepts, and
  `pnpm --filter` is already used by Vercel.

### Comparison

|                      | (a) Nx + two TS | (b) Turborepo           | (c) pnpm only         |
| -------------------- | --------------- | ----------------------- | --------------------- |
| Gets TS 7 type-check | yes (proven)    | only with (a)'s alias   | only with (a)'s alias |
| Files touched        | 8               | ~25                     | ~24                   |
| CI change            | none            | gate step + cache       | gate step, drop cache |
| Caching              | unchanged       | ≈ same, + remote option | none                  |
| Module boundaries    | unchanged       | rewrite + re-prove      | rewrite + re-prove    |
| Effort / risk        | < 1 h / low     | 1–2 d / medium          | ~1 d / medium         |

## Measurements

Cold `tsc --noEmit -p tsconfig.json` per project: `*.tsbuildinfo` deleted
before every run, 3 runs each, invoked as `node node_modules/<pkg>/bin/tsc`.
`hyperfine` isn't installed, so a bash loop timed with `date +%s%N`. Machine:
AMD Ryzen 7 9800X3D (16 threads), 60 GB RAM, Node 26.3.0, Linux. The web
project has a generated `routeTree.gen.ts`. Milliseconds, median of 3 (raw
runs in brackets):

| Project                                          | TS 6.0.3              | TS 7.0.2              | Speed-up |
| ------------------------------------------------ | --------------------- | --------------------- | -------- |
| `apps/web`                                       | 7241 [7241 7231 7470] | 1275 [1275 1247 1298] | 5.7×     |
| `packages/gateway`                               | 2814 [2806 3020 2814] | 604 [616 604 584]     | 4.7×     |
| `packages/domain`                                | 983 [1077 983 960]    | 112 [112 110 113]     | 8.8×     |
| `packages/email`                                 | 719 [719 726 709]     | 86 [86 86 81]         | 8.4×     |
| `packages/contracts`                             | 255 [241 255 276]     | 41 [41 41 42]         | 6.2×     |
| `packages/backend` (0 files)                     | 47 [47 45 47]         | 15 [15 14 15]         | —        |
| **Sum of CI type-check targets**                 | **12059**             | **2133**              | **5.7×** |
| `backend/convex/tsconfig.json` (not a CI target) | 3693 [3747 3646 3693] | 660 [663 660 644]     | 5.6×     |

End to end through Nx, cold, as CI runs it:
`NX_DAEMON=false nx run-many -t type-check --parallel=4 --skip-nx-cache`, 3
runs. Same scripts, only the compiler path switched:

| Compiler | Runs (ms)        | Median |
| -------- | ---------------- | ------ |
| TS 6.0.3 | 8660, 8222, 8642 | 8642   |
| TS 7.0.2 | 2018, 1915, 1869 | 1915   |

That is 4.5× faster end to end, because Nx and pnpm startup overhead stays the
same.

## Recommendation: (a)

Keep Nx and run TS 7's native `tsc` for the `type-check` targets under the
`typescript7` npm alias. Keep `typescript@6.0.3` for API consumers. This is
the only option that delivers TS 7 today. Options (b) and (c) need exactly the
same two-TypeScript setup, because typescript-eslint (via
`eslint-config-next`) still caps at `<6.1.0`. Replacing Nx would be a separate
1–2 day migration whose main effect is rewriting and re-proving the
architecture boundary rules (`@nx/enforce-module-boundaries`), with little
gain. Our Nx use is thin (run-commands wrappers around package scripts plus a
CI cache), so Nx isn't costing much either. It is mostly install weight, and
most of that is the stale `@nx/next` plugin.

If the user still wants a simpler repo, the cheap win is Nx hygiene, not a
replacement:

1. Remove `@nx/next` (and its `nx.json` plugin entry). That drops `next` and
   `sharp` from the install. It probably also lets `@nx/web` go (only the
   inferred `serve-static` target uses it).
2. Drop the duplicate inferred `typecheck` targets
   (`typecheckTargetName` in the `@nx/vite/plugin` options).
3. Give the backend a real type-check target for `convex/tsconfig.json` once
   its 202 errors are fixed, and delete the no-op `build`/`type-check`.

If the team later wants off Nx, choose (c) over (b). The CI gate is fast
enough without a cache, and the end state has the fewest concepts. Do it
after typescript-eslint supports TS 7, so it is one clean step.

## Prototype (this branch)

- Root `package.json`: `"typescript7": "npm:typescript@7.0.2"`.
- `type-check` scripts in `apps/web` and `packages/{backend,contracts,domain,email,gateway}`:
  `node ../../node_modules/typescript7/bin/tsc --noEmit`.
- Full CI-mirroring verify suite passes (see the PR).

## Not determined

- Whether Nx 24 (still beta) removes the `readConfigFile` dependency. The
  registry metadata can't show that, and I didn't install the beta.
- typescript-eslint's TS 7 timeline. No `9.x` or TS-7-peer canary exists.
- Runtimes on GitHub's runners. All numbers above are local.
- Editor (tsserver) behaviour with two TypeScripts. VS Code uses the
  workspace `typescript` (6.0.3) unless pointed at the alias.
