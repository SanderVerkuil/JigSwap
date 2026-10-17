import nextVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

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
  // Hexagonal architecture: enforce dependency direction between workspace packages.
  // Each package is one element; a package may only import the element types listed for it.
  {
    files: ["**/*.{ts,tsx,js,jsx}"],
    plugins: { boundaries },
    settings: {
      // Element patterns are repo-relative; the plugin resolves them against the CWD unless told
      // otherwise, and every package's `lint` script runs from inside its own package.
      "boundaries/root-path": import.meta.dirname,
      "import/resolver": {
        typescript: {
          project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
          noWarnOnMultipleProjects: true,
        },
      },
      "boundaries/elements": [
        { type: "app", pattern: "apps/web" },
        { type: "gateway", pattern: "packages/gateway" },
        { type: "backend-adapter", pattern: "packages/backend" },
        { type: "backend-adapter", pattern: "packages/email" },
        { type: "contracts", pattern: "packages/contracts" },
        { type: "domain", pattern: "packages/domain" },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "allow",
          policies: Object.entries({
            // The domain core is pure: it may only depend on other domain code.
            domain: ["domain"],
            // Contracts are the published language: self-contained.
            contracts: ["contracts"],
            // Backend adapters wire domain + contracts behind ports.
            "backend-adapter": ["domain", "contracts", "backend-adapter"],
            // The gateway is the shared transport seam: it alone reaches the Convex generated API,
            // so every web tier depends on it instead of _generated directly.
            gateway: ["contracts", "backend-adapter", "gateway"],
            // App (BFF + UI) speaks contracts and reaches the backend through the gateway;
            // backend-adapter stays allowed transitionally (removed in a later phase).
            app: ["contracts", "backend-adapter", "gateway", "app"],
          }).map(([from, allowed]) => ({
            from: { element: { type: from } },
            disallow: {
              to: { element: { type: `!(${allowed.join("|")})` } },
            },
          })),
        },
      ],
    },
  },
  // The app reaches Convex via @jigswap/gateway, never the generated API directly.
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    ignores: ["apps/web/src/routeTree.gen.ts"],
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
              message:
                "Import Convex through @jigswap/gateway, not the generated API directly.",
            },
          ],
        },
      ],
      // The Start app is not Next.js: its full HTML document legitimately renders
      // <head>, and it has no Next pages/ dir, so disable the Next-only rules here.
      "@next/next/no-head-element": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  // The generated TanStack route tree is machine-written; never lint it.
  {
    ignores: ["apps/web/src/routeTree.gen.ts"],
  },
  // Convex's _generated sources are machine-written; never lint them (their eslint-disable
  // headers otherwise report as unused once the surrounding rules go quiet).
  {
    ignores: ["**/_generated/**"],
  },
  // Honor the leading-underscore "intentionally unused" convention (dormant stub-adapter params,
  // ignored catch bindings) instead of forcing dead-looking renames.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
];

export default eslintConfig;
