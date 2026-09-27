import { config } from "@repo/eslint-config/base";
export default [
  ...config,
  {
    files: ["src/**/*.ts"],
    // Babel's core scope rules do not understand TypeScript declarations.
    // The compiler checks undefined and unused symbols in tsconfig.json.
    rules: { "no-undef": "off", "no-unused-vars": "off" },
  },
];
