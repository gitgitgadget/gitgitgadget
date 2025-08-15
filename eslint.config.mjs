import eslint from "@eslint/js";
import stylistic from "@stylistic/eslint-plugin";
import jsdoc from "eslint-plugin-jsdoc";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";
import eslintPluginSecurity from "eslint-plugin-security";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // ignore these directories and files (not included on command line)
    ignores: ["**/build/**"],
  },
  eslint.configs.recommended,
  eslintPluginSecurity.configs.recommended,
  {
    plugins: {
      jsdoc,
      "@stylistic": stylistic,
      ...eslintConfigPrettier.plugins,
      prettier: eslintPluginPrettier,
    },

    languageOptions: {
      globals: {
        ...globals.node,
      },

      ecmaVersion: "latest",
      sourceType: "module",
    },

    rules: {
      ...eslintConfigPrettier.rules,
      "@stylistic/function-call-argument-newline": ["warn", "consistent"],
      "@stylistic/function-paren-newline": ["error", "consistent"],
      "@stylistic/max-len": [
        "error",
        {
          code: 120,
        },
      ],
      "@stylistic/new-parens": "error",
      "@stylistic/no-multi-spaces": [
        "error",
        {
          ignoreEOLComments: true,
        },
      ],
      "@stylistic/spaced-comment": [
        "error",
        "always",
        {
          markers: ["/"],
        },
      ],

      "arrow-body-style": "off",
      complexity: "off",
      "constructor-super": "error",
      eqeqeq: ["error", "smart"],
      "guard-for-in": "error",

      "id-denylist": [
        "error",
        "any",
        "Number",
        "String",
        "string",
        "Boolean",
        "boolean",
        "Undefined",
        "undefined",
      ],

      "id-match": "error",
      "jsdoc/check-alignment": "error",

      "jsdoc/check-indentation": [
        "error",
        {
          excludeTags: ["param"],
        },
      ],

      "jsdoc/tag-lines": [
        "error",
        "any",
        {
          startLines: 1,
        },
      ],

      "max-classes-per-file": ["error", 2],

      "no-bitwise": "error",
      "no-caller": "error",
      "no-cond-assign": "error",
      "no-console": "off",
      "no-debugger": "error",
      "no-empty": "error",
      "no-eval": "error",
      "no-fallthrough": "off",
      "no-invalid-this": "off",
      "no-new-wrappers": "error",

      "no-shadow": [
        "error",
        {
          hoist: "never",
        },
      ],

      "no-throw-literal": "error",
      "no-undef-init": "error",
      "no-underscore-dangle": "error",
      "no-unsafe-finally": "error",
      "no-unused-labels": "error",
      "no-unused-vars": "off",
      "object-shorthand": "error",
      "one-var": ["error", "never"],
      "prefer-arrow-callback": "off",
      "prettier/prettier": "warn",
      radix: "error",
      "use-isnan": "error",
      "security/detect-object-injection": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    rules: {
      "@stylistic/semi": ["error", "never"],
      "prettier/prettier": [
        "warn",
        {
          semi: false,
        },
      ],
    },
  },
  {
    files: ["tests/*.ts", "lib/*.ts", "script/*.ts"],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: "tsconfig.eslint.json",
      },
    },
    rules: {
      "@typescript-eslint/array-type": [
        "error",
        {
          default: "array-simple",
        },
      ],

      "@typescript-eslint/consistent-type-assertions": "error",
      "@typescript-eslint/dot-notation": "error",

      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: "variable",
          format: ["camelCase", "snake_case"],
        },
      ],

      "@typescript-eslint/no-explicit-any": [
        "error",
        {
          ignoreRestArgs: true,
        },
      ],

      "@typescript-eslint/no-unused-expressions": "error",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/prefer-for-of": "error",
      "@typescript-eslint/prefer-function-type": "error",
      "@typescript-eslint/prefer-regexp-exec": "off",
      "@typescript-eslint/restrict-template-expressions": "off",

      "@typescript-eslint/triple-slash-reference": [
        "error",
        {
          path: "always",
          types: "prefer-import",
          lib: "always",
        },
      ],

      "@typescript-eslint/unified-signatures": "error",
    },
  },
  // eslintPluginPrettierRecommended,
);
