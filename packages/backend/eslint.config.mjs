import nx from "@nx/eslint-plugin";
import baseConfig from "../../eslint.config.mjs";

export default [
  ...baseConfig,
  {
    files: ["**/*.json"],
    plugins: { "@nx": nx },
    rules: {
      "@nx/dependency-checks": [
        "error",
        {
          ignoredFiles: [
            "{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}",
            "{projectRoot}/vite.config.{js,ts,mjs,mts}",
            // Vitest setup file (wired via vite.config setupFiles); test-only, not a *.test.ts,
            // so the check would otherwise demand its vitest import be a runtime dependency.
            "{projectRoot}/test-setup.ts",
          ],
          // @jigswap/domain and @jigswap/contracts are consumed by the Convex source (convex/**),
          // which sits outside the nx build `src` root the check scans, so it cannot see the usage.
          ignoredDependencies: ["@jigswap/domain", "@jigswap/contracts"],
        },
      ],
    },
    languageOptions: {
      parser: await import("jsonc-eslint-parser"),
    },
  },
  {
    // The hexagon intends backend adapters to import the PURE domain source package
    // (@jigswap/domain has no build target by design); the buildable-lib subcheck conflicts
    // with that, while the depConstraints in the root config still enforce the real boundaries.
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "@nx": nx },
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          allow: [],
          enforceBuildableLibDependency: false,
          depConstraints: [
            { sourceTag: "type:domain", onlyDependOnLibsWithTags: ["type:domain"] },
            { sourceTag: "type:contracts", onlyDependOnLibsWithTags: ["type:contracts"] },
            {
              sourceTag: "type:backend-adapter",
              onlyDependOnLibsWithTags: ["type:domain", "type:contracts", "type:backend-adapter"],
            },
            {
              sourceTag: "type:app",
              onlyDependOnLibsWithTags: ["type:contracts", "type:backend-adapter", "type:app"],
            },
            { sourceTag: "scope:*", onlyDependOnLibsWithTags: ["scope:*"] },
          ],
        },
      ],
    },
  },
];
