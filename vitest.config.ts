import { defineConfig } from "vitest/config";

const testArtifacts = [
  "**/node_modules/**",
  "**/.git/**",
  "**/.ai-bridge/**",
  "**/skills/**",
  "**/test-results/**",
  "**/playwright-report/**",
  "**/coverage/**",
  "**/dist/**",
];

export default defineConfig({
  test: {
    exclude: testArtifacts,
    coverage: {
      provider: "v8",
      reportsDirectory: "coverage",
      reporter: ["text-summary", "json-summary", "lcov", "html"],
      reportOnFailure: true,
      skipFull: true,
      thresholds: {
        statements: 26,
        branches: 22,
        functions: 18,
        lines: 27,
      },
      include: [
        "apps/*/src/**/*.{js,jsx,ts,tsx,mjs,cjs}",
        "packages/*/src/**/*.{js,jsx,ts,tsx,mjs,cjs}",
        "scripts/**/*.{js,jsx,ts,tsx,mjs,cjs}",
      ],
      exclude: [
        ...testArtifacts,
        "**/*.{test,spec}.{js,jsx,ts,tsx,mjs,cjs}",
        "**/*-boundaries.test.{js,jsx,ts,tsx,mjs,cjs}",
        "**/*.d.ts",
        "**/*.config.{js,ts,mjs,cjs}",
        "**/routeTree.gen.ts",
        "**/generated/**",
        "**/openapi.json",
      ],
    },
  },
});
