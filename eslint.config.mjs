import nextVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...nextVitals,
  ...typescript,
  {
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
];

export default eslintConfig;
