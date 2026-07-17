import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  getUserPermissions: vi.fn(),
}));

vi.mock("@scalius/core/auth", () => ({
  getAuth: mocks.getAuth,
}));

vi.mock("@scalius/core/auth/rbac/helpers", () => ({
  getUserPermissions: mocks.getUserPermissions,
}));

import { adminAuthMiddleware } from "./admin-auth";

function createContext(pathname: string) {
  const request = new Request(`https://api.marketplace.test${pathname}`);
  return {
    env: {},
    req: {
      raw: request,
      url: request.url,
      path: pathname,
      method: "GET",
      header: (name: string) => request.headers.get(name) ?? undefined,
    },
    set: vi.fn(),
    get: vi.fn((key: string) => (key === "db" ? { id: "db" } : undefined)),
  };
}

describe("seller dashboard authentication boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.getAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { id: "session_1", twoFactorVerified: true },
          user: {
            id: "seller_user_1",
            email: "seller@marketplace.test",
            name: "Seller",
            role: "user",
            twoFactorEnabled: false,
          },
        }),
      },
    });
  });

  it("allows a verified seller session without platform RBAC permissions", async () => {
    mocks.getUserPermissions.mockResolvedValue(new Set());
    const next = vi.fn().mockResolvedValue(undefined);

    await adminAuthMiddleware(
      createContext("/api/v1/admin/vendor-dashboard/summary") as never,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
    expect(mocks.getUserPermissions).not.toHaveBeenCalled();
  });

  it("still requires two-factor completion before seller capability checks", async () => {
    mocks.getAuth.mockReturnValue({
      api: {
        getSession: vi.fn().mockResolvedValue({
          session: { id: "session_1", twoFactorVerified: false },
          user: {
            id: "seller_user_1",
            email: "seller@marketplace.test",
            name: "Seller",
            role: "user",
            twoFactorEnabled: true,
          },
        }),
      },
    });
    const next = vi.fn();

    await expect(
      adminAuthMiddleware(
        createContext("/api/v1/admin/vendor-dashboard/summary") as never,
        next,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Two-factor verification required" });

    expect(next).not.toHaveBeenCalled();
    expect(mocks.getUserPermissions).not.toHaveBeenCalled();
  });
});
