import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appPath = fileURLToPath(new URL("./app.ts", import.meta.url));

describe("storefront order route authentication boundary", () => {
  it("keeps tokenized storefront order routes outside legacy JWT middleware", () => {
    const source = readFileSync(appPath, "utf8");

    expect(source).toContain('app.use("/orders/*", cookieOriginGuardMiddleware)');
    expect(source).not.toContain('app.use("/orders/*", authMiddleware)');
    expect(source).toContain('app.route("/orders", orderRoutes)');
  });
});
