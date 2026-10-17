# backend

Convex functions, schema and their convex-test suites.

## Type-checking

Run `pnpm type-check` to type-check the Convex functions (tests excluded; see `tsconfig.json`).

Every Convex deploy also type-checks, and fails on a type error. The CLI runs
`node_modules/typescript/bin/tsc --project convex` from this package, so `typescript` is a
devDependency here. That check uses `convex/tsconfig.json`, which **includes** the
`*.test.ts` suites. All deploy commands (`convex-deploy.yml`, `convex-preview.yml`,
`scripts/vercel-build.sh`) pass `--typecheck enable`. Without it the CLI default (`try`)
silently skips the check when it can't find `tsc`. To run the same check locally without
deploying:

```bash
node node_modules/typescript/bin/tsc --noEmit --project convex
```

## Running unit tests

Run `pnpm test` to execute the unit tests via [Vitest](https://vitest.dev/).
