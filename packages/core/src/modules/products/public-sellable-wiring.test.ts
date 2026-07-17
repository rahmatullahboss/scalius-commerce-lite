import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const productsDirectory = fileURLToPath(new URL(".", import.meta.url));
const ordersDirectory = fileURLToPath(new URL("../orders/", import.meta.url));
const modulesDirectory = fileURLToPath(new URL("../", import.meta.url));

function countOccurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

describe("public sellable product wiring", () => {
  it("uses the canonical predicate for every storefront product surface", () => {
    const source = readFileSync(`${productsDirectory}/products.storefront.ts`, "utf8");

    expect(source).toContain('from "./public-sellable"');
    expect(countOccurrences(source, "getPublicSellableProductConditions()")).toBeGreaterThanOrEqual(4);
  });

  it("revalidates the canonical predicate during cart validation", () => {
    const source = readFileSync(`${ordersDirectory}/cart-validation.ts`, "utf8");

    expect(source).toContain('from "../products/public-sellable"');
    expect(source).toContain("...getPublicSellableProductConditions()");
  });

  it("protects collection, widget, attribute, discount, and inventory product readers", () => {
    const protectedReaders = [
      ["collections/collections.service.ts", 8],
      ["widgets/widgets.service.ts", 3],
      ["attributes/attributes.public.ts", 2],
      ["discounts/discounts.eligibility.ts", 1],
      ["inventory/reserve.ts", 2],
    ] as const;

    for (const [relativePath, minimumUses] of protectedReaders) {
      const source = readFileSync(`${modulesDirectory}/${relativePath}`, "utf8");
      expect(source, relativePath).toContain("public-sellable");
      expect(
        countOccurrences(source, "getPublicSellableProductConditions()"),
        relativePath,
      ).toBeGreaterThanOrEqual(minimumUses);
    }
  });
});
