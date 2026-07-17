#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");

export const ACTIVE_ISOLATION_FILES = Object.freeze([
  "apps/api/wrangler.jsonc",
  "apps/api/wrangler.local.jsonc",
  "apps/admin-v2/wrangler.jsonc",
  "apps/storefront/wrangler.jsonc",
  "apps/api/src/queue-consumer.ts",
  "scripts/deploy.mjs",
]);

const FORBIDDEN_ACTIVE_PATTERNS = Object.freeze([
  { label: "original Scalius domain", pattern: /(?:^|[\s"'`/:.])(?:api|dashboard|storefront|cloud)\.scalius\.com\b/i },
  { label: "original Scalius Worker", pattern: /\bscalius-(?:api|admin-v2|storefront)(?:-local)?\b/i },
  { label: "original Scalius D1 name", pattern: /\bscalius-commerce\b/i },
  { label: "original Scalius R2 bucket", pattern: /\bscalius-media\b/i },
  { label: "original Scalius D1 id", pattern: /\b2efcad0d-841e-4f8d-b8f6-5b735d881edc\b/i },
  { label: "original Scalius KV id", pattern: /\b(?:d6e2d77d898e4b3f9c186802ce63f9b8|9f577136c05144349f2b8013a4fc1cc5|0564d3a6c3704c8c9f355b7ec5498f50|b69ad8d7d9b342bb83849caef7142842|7e26aa6f7fb344429379d845e5492cb4)\b/i },
]);

function isHistoricalOrTestPath(path) {
  return path.startsWith("docs/")
    || path.startsWith("audit/")
    || /(?:^|\/)README\.md$/i.test(path)
    || /(?:^|\/)SECURITY\.md$/i.test(path)
    || /(?:^|\/)CODE_OF_CONDUCT\.md$/i.test(path)
    || /(?:^|\/)CONTRIBUTING\.md$/i.test(path)
    || /(?:\.test\.|\.spec\.)/.test(path);
}

export function collectProjectIsolationIssues(files) {
  const issues = [];

  for (const [path, content] of Object.entries(files)) {
    if (isHistoricalOrTestPath(path)) continue;

    for (const { label, pattern } of FORBIDDEN_ACTIVE_PATTERNS) {
      if (pattern.test(content)) {
        issues.push(`${path}: contains ${label}; active configuration must not connect to the original Scalius project.`);
      }
    }
  }

  return issues;
}

export function readActiveIsolationFiles(root = repoRoot) {
  return Object.fromEntries(ACTIVE_ISOLATION_FILES.map((path) => [
    path,
    readFileSync(resolve(root, path), "utf8"),
  ]));
}

export function checkProjectIsolation(root = repoRoot) {
  const issues = collectProjectIsolationIssues(readActiveIsolationFiles(root));
  if (issues.length > 0) {
    throw new Error(`Project isolation check failed:\n- ${issues.join("\n- ")}`);
  }
  return { checkedFiles: ACTIVE_ISOLATION_FILES.length };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = checkProjectIsolation(repoRoot);
    console.log(`Project isolation OK: ${result.checkedFiles} active files contain no original deployment connections.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
