import { describe, expect, it } from "vitest";
import { phoneNumberSchema } from "./customer-utils";

describe("phoneNumberSchema", () => {
  it("normalizes a valid Bangladesh E.164 number", () => {
    expect(phoneNumberSchema.parse("+8801812345678")).toBe("+8801812345678");
  });

  it("returns a Zod validation issue instead of throwing a raw transform error", () => {
    const result = phoneNumberSchema.safeParse("01800000000");

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Invalid phone number format");
    }
  });
});
