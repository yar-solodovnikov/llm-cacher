import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-magic-numbers": [
        "error",
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          ignoreDefaultValues: true,
          ignoreEnums: true,
          ignoreNumericLiteralTypes: true,
          ignoreReadonlyClassProperties: true,
          ignoreTypeIndexes: true,
        },
      ],
    },
  },
  {
    // tests freely use numeric literals as test data
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-magic-numbers": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "eslint.config.js"],
  },
);
