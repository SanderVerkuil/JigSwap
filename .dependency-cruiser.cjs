// Keeps the @jigswap/domain core pure: no framework, no validation library,
// no Convex, no Clerk, and no dependency on contracts/backend packages.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "domain-stays-framework-free",
      comment:
        "packages/domain is the pure hexagon core: it must not import Convex, Clerk, React, Next, or zod.",
      severity: "error",
      from: { path: "^packages/domain" },
      to: {
        path: [
          "^convex$",
          "^convex/values$",
          "^convex-helpers",
          "^@clerk/",
          "^react$",
          "^react-dom$",
          "^next$",
          "^next/",
          "^zod$",
        ],
      },
    },
    {
      name: "domain-no-sibling-packages",
      comment:
        "packages/domain must not depend on contracts or backend; dependencies point inward only.",
      severity: "error",
      from: { path: "^packages/domain" },
      to: {
        path: [
          "^packages/contracts",
          "^packages/backend",
          "@jigswap/contracts",
          "@jigswap/backend",
        ],
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    // Parse with swc, not the TypeScript compiler API: TS 7 has no JS API. swc parses the
    // TypeScript source itself, so `import type` / `export type` still count as dependencies.
    // tsPreCompilationDeps and tsConfig are left out on purpose: both only work through the
    // TS API (with TS 7 they'd silently do nothing and print a missing-transpiler warning).
    parser: "swc",
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
