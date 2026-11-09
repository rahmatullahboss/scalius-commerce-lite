import { describe, expect, it } from "vitest";
import { classifyEmailSignInResponse } from "./login-sign-in-outcome";

describe("email login continuation", () => {
  it("redirects a Better Auth nested 2FA challenge instead of treating it as login", () => {
    expect(classifyEmailSignInResponse({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp", "otp"] },
      error: null,
    })).toEqual({ kind: "two-factor", methods: ["totp", "otp"] });
  });

  it("accepts the usual client data envelope as authenticated", () => {
    expect(classifyEmailSignInResponse({ data: { twoFactorRedirect: false } }))
      .toEqual({ kind: "authenticated" });
  });

  it("shows credential errors instead of redirecting", () => {
    expect(classifyEmailSignInResponse({
      data: { twoFactorRedirect: true, twoFactorMethods: ["totp"] },
      error: { message: "Invalid credentials" },
    })).toEqual({ kind: "error", message: "Invalid credentials" });
  });

  it("rejects a missing data envelope rather than navigating to Admin", () => {
    expect(classifyEmailSignInResponse({ data: null, error: null }))
      .toEqual({ kind: "error", message: "Sign in could not establish a session. Please try again." });
  });

  it("does not mistake a top-level 2FA flag for an authenticated client response", () => {
    const malformed = { twoFactorRedirect: true, data: null };
    expect(classifyEmailSignInResponse(malformed))
      .toMatchObject({ kind: "error" });
  });
});
