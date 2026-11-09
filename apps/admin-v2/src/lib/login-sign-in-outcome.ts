/**
 * Better Auth client calls resolve to { data, error }. A 2FA challenge is in
 * data.twoFactorRedirect, not a top-level field and not an authenticated session.
 */
export type EmailSignInResponse = {
  data?: {
    twoFactorRedirect?: boolean;
    twoFactorMethods?: readonly unknown[];
  } | null;
  error?: { message?: string } | null;
};

export type EmailSignInOutcome =
  | { kind: "error"; message: string }
  | { kind: "two-factor"; methods: readonly unknown[] | undefined }
  | { kind: "authenticated" };

export function classifyEmailSignInResponse(response: EmailSignInResponse): EmailSignInOutcome {
  if (response.error) {
    return { kind: "error", message: response.error.message || "Invalid email or password." };
  }
  if (response.data?.twoFactorRedirect === true) {
    return { kind: "two-factor", methods: response.data.twoFactorMethods };
  }
  if (!response.data) {
    return { kind: "error", message: "Sign in could not establish a session. Please try again." };
  }
  return { kind: "authenticated" };
}
