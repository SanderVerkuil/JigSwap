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
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import("jsonc-eslint-parser"),
    },
  },
];
