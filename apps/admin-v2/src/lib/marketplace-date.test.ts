import { describe, expect, it } from "vitest";
import { formatMarketplaceDate } from "./marketplace-date";

describe("formatMarketplaceDate", () => {
  it("renders the same fixed marketplace timezone for Date, seconds, and milliseconds", () => {
    const milliseconds = Date.UTC(2026, 6, 15, 16, 22, 9);
    const expected = "Jul 15, 2026, 10:22:09 PM";

    expect(formatMarketplaceDate(new Date(milliseconds))).toBe(expected);
    expect(formatMarketplaceDate(milliseconds)).toBe(expected);
    expect(formatMarketplaceDate(milliseconds / 1000)).toBe(expected);
  });

  it("handles missing and invalid values without throwing", () => {
    expect(formatMarketplaceDate(null)).toBe("—");
    expect(formatMarketplaceDate(undefined, "unknown")).toBe("unknown");
    expect(formatMarketplaceDate("not-a-date")).toBe("not-a-date");
  });
});
