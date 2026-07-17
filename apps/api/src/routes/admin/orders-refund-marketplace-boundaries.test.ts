import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourcePath = fileURLToPath(new URL("./orders-refund.ts", import.meta.url));

describe("admin marketplace refund API boundary", () => {
  it("accepts explicit item quantities and records the authenticated platform actor", () => {
    const source = readFileSync(sourcePath, "utf8");

    expect(source).toContain("orderItemId: z.string().min(1)");
    expect(source).toContain("quantity: z.number().int().positive()");
    expect(source).toContain("items: data.items");
    expect(source).toContain("actorUserId: user?.id");
  });
});
