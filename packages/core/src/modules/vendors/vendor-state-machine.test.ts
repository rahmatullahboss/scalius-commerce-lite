import { describe, expect, it } from "vitest";
import {
  assertProductModerationTransition,
  assertVendorStatusTransition,
} from "./vendor-state-machine";

describe("vendor status state machine", () => {
  it.each([
    ["pending", "approved"],
    ["pending", "rejected"],
    ["approved", "suspended"],
    ["approved", "closed"],
    ["rejected", "pending"],
    ["suspended", "approved"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(() => assertVendorStatusTransition(from, to)).not.toThrow();
  });

  it.each([
    ["closed", "approved"],
    ["pending", "suspended"],
    ["rejected", "approved"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => assertVendorStatusTransition(from, to)).toThrow(/invalid vendor status transition/i);
  });
});

describe("product moderation state machine", () => {
  it.each([
    ["draft", "submitted"],
    ["submitted", "approved"],
    ["submitted", "rejected"],
    ["approved", "suspended"],
    ["rejected", "draft"],
    ["rejected", "submitted"],
    ["suspended", "approved"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(() => assertProductModerationTransition(from, to)).not.toThrow();
  });

  it.each([
    ["draft", "approved"],
    ["approved", "draft"],
    ["suspended", "submitted"],
  ] as const)("rejects %s -> %s", (from, to) => {
    expect(() => assertProductModerationTransition(from, to)).toThrow(/invalid product moderation transition/i);
  });
});
