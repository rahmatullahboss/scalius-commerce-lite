import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routePath = fileURLToPath(new URL("./vendor-dashboard.ts", import.meta.url));
const source = readFileSync(routePath, "utf8");

describe("seller onboarding API boundary", () => {
  it("exposes an authenticated seller application route", () => {
    expect(source).toContain('path: "/application"');
    expect(source).toContain('method: "post"');
    expect(source).toContain("applyForVendor");
    expect(source).toContain("correct and resubmit an authenticated seller application");
  });

  it("derives applicant identity from the authenticated session", () => {
    expect(source).toContain("applicantUserId: getCurrentUserId(c)");
    expect(source).not.toContain("ownerUserId: c.req.valid");
  });

  it("gates application writes with the independent onboarding flag", () => {
    expect(source).toContain('assertMarketplaceFeatureEnabled(db, "vendorOnboardingWrite"');
  });

  it("does not accept seller-controlled status or commission policy", () => {
    const applicationBlock = source.slice(
      source.indexOf("const applicationRoute"),
      source.indexOf("const summaryRoute"),
    );
    const requestSchema = applicationBlock.slice(0, applicationBlock.indexOf("responses:"));
    expect(requestSchema).not.toContain("commissionBps");
    expect(requestSchema).not.toContain("status:");
    expect(requestSchema).not.toContain("ownerUserId");
  });

  it("includes pending and rejected applications in seller context", () => {
    expect(source).toContain("includeUnapprovedVendors: true");
  });
});
