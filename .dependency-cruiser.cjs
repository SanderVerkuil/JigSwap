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
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
