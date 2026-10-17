// convex-test suites bundle the Convex modules with Vite's `import.meta.glob`, which vitest
// provides at runtime. Declare only `glob` (not all of `vite/client`, which would also admit
// asset imports and `import.meta.env`) so the test files type-check under convex/tsconfig.json.
// The Convex bundler skips this file (multiple dots), so nothing here reaches a deployment.
interface ImportMeta {
  glob: import("vite/types/importGlob.d.ts").ImportGlobFunction;
}
