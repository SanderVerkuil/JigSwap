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
            // App (BFF + UI) speaks contracts; type:backend-adapter allowed transitionally
            // because the gateway still imports the Convex generated API (removed in a later phase).
            {
              sourceTag: "type:app",
              onlyDependOnLibsWithTags: [
                "type:contracts",
                "type:backend-adapter",
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
];

export default eslintConfig;
