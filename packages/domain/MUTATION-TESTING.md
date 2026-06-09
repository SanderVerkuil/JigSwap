# Mutation Testing (`@jigswap/domain`)

## What it is

[Mutation testing](https://stryker-mutator.io/docs/) measures the *quality* of the
test suite rather than just line coverage. [StrykerJS](https://stryker-mutator.io/)
makes thousands of small, semantics-changing edits ("mutants") to the source — e.g.
flipping `>` to `>=`, replacing a boolean with `true`, removing a method call — then
re-runs the tests against each one.

- A mutant is **killed** when at least one test fails: the tests detected the change. Good.
- A mutant **survives** when all tests still pass: the change went unnoticed, so there
  is a behaviour that no test pins down. These point at weak spots to strengthen later.
- **No coverage** means no test even executes that code.

The **mutation score** is `killed / (killed + survived + no-coverage + timeout)` — the
percentage of injected faults the suite catches.

`@jigswap/domain` is the ideal target: ~193 fast, I/O-free unit tests over pure TypeScript
(shared-kernel + the catalog / exchange / library bounded contexts).

## How to run

From the package:

```bash
cd packages/domain
pnpm run mutation
```

Via Nx (from the repo root):

```bash
nx run @jigswap/domain:mutation
# or the convenience alias:
pnpm run mutation:domain
```

The full run takes roughly 30-60s on a typical dev machine (Stryker re-runs the covering
tests once per mutant; `coverageAnalysis: "perTest"` keeps this fast).

## Report

An interactive HTML report is written to:

```
packages/domain/reports/mutation/mutation-report.html
```

Open it in a browser to drill into surviving mutants file-by-file and line-by-line.
Stryker's temp dir (`.stryker-tmp`), the `reports/` output, and `stryker.log` are
all git-ignored.

## Configuration

See [`stryker.config.json`](./stryker.config.json). Key choices:

- **Runner:** `vitest`, pointed at the package's own `vite.config.ts`. The vite config
  type-strips TypeScript, so no separate `typescript-checker` plugin is needed.
- **Plugin loading:** the vitest runner plugin is declared explicitly via
  `"plugins": ["@stryker-mutator/vitest-runner"]`. Dependencies are hoisted to the
  monorepo root `node_modules`, and there is no `packages/domain/node_modules`, so
  Stryker's default `@stryker-mutator/*` auto-discovery glob does not find it from the
  package cwd. The explicit entry makes loading deterministic.
- **`coverageAnalysis: "perTest"`** — supported by the vitest runner; only re-runs the
  tests that actually cover each mutant.
- **`mutate`** excludes specs, `testing/` fakes, and barrel `index.ts` files so the score
  reflects real production logic only.

## Baseline (measured 2026-06-09, StrykerJS 9.6.1)

| Metric            | Value  |
| ----------------- | ------ |
| **Mutation score**| **80.30%** |
| Total mutants     | 1071   |
| Killed            | 859    |
| Survived          | 175    |
| Timed out         | 1      |
| No coverage       | 36     |
| Errors            | 0      |

### Thresholds

```jsonc
"thresholds": { "high": 85, "low": 78, "break": 75 }
```

- **`break: 75`** — sits ~5 points below the measured 80.30% baseline, so CI is green
  today (80.30 ≥ 75) but any regression that drops the score below 75 fails the build.
- **`low: 78` / `high: 85`** — colour the report (red below 78, yellow 78-85, green above)
  and set the aspirational target as the suite is hardened.

### Notable surviving-mutant hotspots (weak test spots to strengthen later)

These files have the most survivors / lowest scores and are the best targets for
follow-up test hardening (this slice only establishes the baseline — source and specs
were intentionally **not** changed):

- **Fully uncovered (0% — no test executes them):**
  - `exchange/domain/exchange-kind.ts` (4 mutants)
  - `library/domain/condition.ts` (7 mutants)
  - `library/domain/price.ts` (35.29%, 6 survived + 5 no-coverage)
- **High survivor counts:**
  - `catalog/domain/barcode.ts` (75.00%, 22 survived) — validation/check-digit logic.
  - `exchange/domain/exchange.ts` (87.77%, 16 survived) — the largest aggregate.
  - `catalog/domain/puzzle-definition.ts` (78.02%, 14 survived).
  - `exchange/domain/terms.ts` (79.59%, 10 survived).
  - `library/domain/collection.ts` (82.89%, 10 survived).
  - `library/application/use-cases/update-collection.ts` (74.07%, 7 survived).
- **Error/value-object files** (`errors.ts` across contexts, `acquisition.ts`,
  `personal-category.ts`, shared-kernel `domain-error.ts` / `identifier.ts`) — many
  survivors are in error-message construction and rarely-asserted branches.
