import { describe, expect, it } from "vitest";
import {
  assertSafeInstallTarget,
  compareSemver,
  getSuperpowersInstallPlan,
} from "./install-superpowers.mjs";

describe("project-local Superpowers installer", () => {
  it("orders semantic versions numerically", () => {
    expect(compareSemver("6.1.1", "6.0.3")).toBeGreaterThan(0);
    expect(compareSemver("6.0.3", "6.1.1")).toBeLessThan(0);
    expect(compareSemver("6.1.1", "6.1.1")).toBe(0);
    expect(compareSemver("6.10.0", "6.9.9")).toBeGreaterThan(0);
  });

  it("installs the vendored framework and exposes its skills from one canonical source", () => {
    expect(getSuperpowersInstallPlan("6.1.1")).toEqual({
      repository: "https://github.com/obra/superpowers.git",
      ref: "v6.1.1",
      vendorDirectory: ".ai-bridge/superpowers",
      skillsLink: "skills",
      skillsTarget: ".ai-bridge/superpowers/skills",
      versionFile: ".ai-bridge/superpowers-version.json",
    });
  });

  it("rejects install targets outside the project-owned Superpowers paths", () => {
    expect(() => assertSafeInstallTarget(".ai-bridge/superpowers")).not.toThrow();
    expect(() => assertSafeInstallTarget("skills")).not.toThrow();
    expect(() => assertSafeInstallTarget("../superpowers")).toThrow(/unsafe/i);
    expect(() => assertSafeInstallTarget("apps/api")).toThrow(/unsafe/i);
  });
});
