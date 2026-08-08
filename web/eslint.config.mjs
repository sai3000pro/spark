import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // The Figma Make export. Kept on disk as a design reference, but it is a
    // separate Vite app with its own toolchain — not part of this build.
    "Journey Moment Capture App/**",
  ]),
]);

export default eslintConfig;
