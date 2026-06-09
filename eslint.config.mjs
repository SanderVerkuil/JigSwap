import nextVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import nx from "@nx/eslint-plugin";

// Flat-config plugins are block-scoped; reuse next's "import" plugin so the
// rule below resolves even when the Nx graph parser reads this block in isolation.
const importPlugin = nextVitals.find((c) => c.plugins?.import)?.plugins.import;

const eslintConfig = [
  ...nextVitals,
  ...typescript,
  {
    plugins: { import: importPlugin },
    rules: {
      "import/no-anonymous-default-export": [
        "error",
        {
          allowArray: true,
          allowArrowFunction: true,
          allowAnonymousClass: true,
          allowAnonymousFunction: true,
          allowCallExpression: true, // The true value here is for backward compatibility
          allowNew: true,
          allowLiteral: true,
          allowObject: true,
        },
      ],
    },
  },
  // Hexagonal architecture: enforce dependency direction via Nx project tags.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { "@nx": nx },
    rules: {
      "@nx/enforce-module-boundaries": [
        "error",
        {
          allow: [],
          enforceBuildableLibDependency: true,
          depConstraints: [
            // The domain core is pure: it may only depend on other domain code.
            { sourceTag: "type:domain", onlyDependOnLibsWithTags: ["type:domain"] },
            // Contracts are the published language: self-contained.
            { sourceTag: "type:contracts", onlyDependOnLibsWithTags: ["type:contracts"] },
            // Backend adapters wire domain + contracts behind ports.
            {
              sourceTag: "type:backend-adapter",
              onlyDependOnLibsWithTags: [
                "type:domain",
                "type:contracts",
                "type:backend-adapter",
              ],
            },
            // The gateway is the shared transport seam: it alone reaches the Convex generated API,
            // so every web tier depends on it instead of _generated directly.
            {
              sourceTag: "type:gateway",
              onlyDependOnLibsWithTags: [
                "type:contracts",
                "type:backend-adapter",
                "type:gateway",
              ],
            },
            // App (BFF + UI) speaks contracts and reaches the backend through the gateway;
            // type:backend-adapter stays allowed transitionally (removed in a later phase).
            {
              sourceTag: "type:app",
              onlyDependOnLibsWithTags: [
                "type:contracts",
                "type:backend-adapter",
                "type:gateway",
                "type:app",
              ],
            },
            // Scope is non-restrictive for now; tag-based type rules above do the enforcing.
            { sourceTag: "scope:*", onlyDependOnLibsWithTags: ["scope:*"] },
          ],
        },
      ],
    },
  },
  // The UI must reach Convex through @/gateway, never the generated API directly.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/gateway/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/_generated/api",
                "**/_generated/dataModel",
                "@jigswap/backend/convex/_generated/*",
              ],
              message: "Import Convex through @/gateway, not the generated API directly.",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
