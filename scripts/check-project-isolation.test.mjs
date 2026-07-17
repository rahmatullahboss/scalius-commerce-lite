import { describe, expect, it } from "vitest";
import { collectProjectIsolationIssues } from "./check-project-isolation.mjs";

describe("project isolation guard", () => {
  it("rejects original production domains and resource identities in active files", () => {
    const issues = collectProjectIsolationIssues({
      "apps/api/wrangler.jsonc": `{
        "name": "scalius-api",
        "database_id": "2efcad0d-841e-4f8d-b8f6-5b735d881edc",
        "PUBLIC_API_BASE_URL": "https://api.scalius.com"
      }`,
      "apps/api/src/queue-consumer.ts": `const fallback = "https://api.scalius.com";`,
    });

    expect(issues).toEqual(expect.arrayContaining([
      expect.stringContaining("apps/api/wrangler.jsonc"),
      expect.stringContaining("apps/api/src/queue-consumer.ts"),
    ]));
    expect(issues.join("\n")).toContain("original Scalius");
  });

  it("accepts local-owned runtime configuration", () => {
    expect(collectProjectIsolationIssues({
      "apps/api/wrangler.jsonc": `{
        "name": "marketplace-api-local",
        "database_name": "marketplace-local-db",
        "PUBLIC_API_BASE_URL": "http://localhost:8787"
      }`,
      "apps/api/src/queue-consumer.ts": `const fallback = "http://localhost:8787";`,
    })).toEqual([]);
  });

  it("does not treat historical documentation or test fixtures as active connections", () => {
    expect(collectProjectIsolationIssues({
      "docs/architecture/multivendor/audit.md": "Historical endpoint: https://api.scalius.com",
      "apps/api/src/example.test.ts": "expect(url).toBe('https://api.scalius.com')",
    })).toEqual([]);
  });
});
