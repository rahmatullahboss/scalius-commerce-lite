import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const apiUrl = process.env.E2E_API_URL ?? "http://localhost:8787";
const adminUrl = process.env.E2E_ADMIN_URL ?? "http://localhost:4323";
const storefrontUrl = process.env.E2E_STOREFRONT_URL ?? "http://localhost:4322";

const localAdminHelperSource = readFileSync("scripts/dev-admin.mjs", "utf8");

function readLocalAdminDefault(field: "email" | "password"): string {
  const match = localAdminHelperSource.match(
    new RegExp(`${field}:\\s*process\\.env\\.[A-Z_]+\\s*\\|\\|\\s*\"([^\"]+)\"`),
  );
  if (!match?.[1]) {
    throw new Error(`Could not read the local admin ${field} default from scripts/dev-admin.mjs`);
  }
  return match[1];
}

const adminEmail =
  process.env.E2E_ADMIN_EMAIL ??
  process.env.LOCAL_ADMIN_EMAIL ??
  readLocalAdminDefault("email");
const adminPassword =
  process.env.E2E_ADMIN_PASSWORD ??
  process.env.LOCAL_ADMIN_PASSWORD ??
  readLocalAdminDefault("password");

const localApiWorkspace = "apps/api";
const localWranglerArgs = [
  "--config",
  "wrangler.local.jsonc",
  "--local",
  "--persist-to",
  "../../.wrangler/state",
] as const;

function runLocalWrangler(args: string[]): string {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return execFileSync("pnpm", ["exec", "wrangler", ...args], {
        cwd: localApiWorkspace,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      lastError = error;
      const stderr = error instanceof Error && "stderr" in error
        ? String((error as Error & { stderr?: string | Buffer }).stderr ?? "")
        : String(error);
      if (!/SQLITE_BUSY|database is locked/i.test(stderr) || attempt === 4) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
  throw lastError;
}

function readLocalMarketplaceFlag(key: string): string | null {
  const output = runLocalWrangler([
    "d1",
    "execute",
    "marketplace-local-db",
    ...localWranglerArgs,
    "--command",
    `SELECT value FROM settings WHERE category = 'marketplace' AND key = '${key}'`,
    "--json",
  ]);
  const result = JSON.parse(output) as Array<{ results?: Array<{ value?: string }> }>;
  return result[0]?.results?.[0]?.value ?? null;
}

function writeLocalMarketplaceFlag(key: string, value: string | null): void {
  const command = value == null
    ? `DELETE FROM settings WHERE category = 'marketplace' AND key = '${key}'`
    : `INSERT INTO settings (id, key, value, type, category, updated_at)
       VALUES ('e2e_marketplace_${key}', '${key}', '${value}', 'boolean', 'marketplace', unixepoch())
       ON CONFLICT(key, category) DO UPDATE SET value = excluded.value, type = excluded.type, updated_at = unixepoch()`;

  runLocalWrangler([
    "d1",
    "execute",
    "marketplace-local-db",
    ...localWranglerArgs,
    "--command",
    command,
  ]);
  runLocalWrangler([
    "kv",
    "key",
    "delete",
    "gw:marketplace_flags:v1",
    "--binding",
    "CACHE",
    ...localWranglerArgs,
  ]);
}

function enableLocalMarketplaceFlags(keys: string[]): () => void {
  const previous = new Map(keys.map((key) => [key, readLocalMarketplaceFlag(key)]));
  for (const key of keys) writeLocalMarketplaceFlag(key, "true");
  return () => {
    for (const key of [...keys].reverse()) {
      writeLocalMarketplaceFlag(key, previous.get(key) ?? null);
    }
  };
}

async function getStatus(request: APIRequestContext, url: string): Promise<number> {
  try {
    return (await request.get(url)).status();
  } catch {
    return 0;
  }
}

async function expectLoginForm(page: import("@playwright/test").Page) {
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
}

async function waitForReactControl(
  locator: ReturnType<Page["getByLabel"]>,
  timeout = 30_000,
) {
  await expect(locator).toBeVisible({ timeout });
  await expect
    .poll(
      async () => {
        try {
          return await locator.evaluate((element) =>
            Object.keys(element).some(
              (key) => key.startsWith("__reactProps$") || key.startsWith("__reactFiber$"),
            ),
          );
        } catch {
          return false;
        }
      },
      { timeout },
    )
    .toBe(true);
}

async function waitForLoginHydration(page: Page) {
  await waitForReactControl(page.getByLabel("Email"));
}

async function signIn(
  page: Page,
  email: string,
  password: string,
  expectedPath: RegExp = /\/admin(?:\/)?$/,
) {
  await page.goto(`${adminUrl}/auth/login`);
  await waitForLoginHydration(page);
  const emailInput = page.getByLabel("Email");
  const passwordInput = page.getByLabel("Password");
  await emailInput.fill(email);
  await passwordInput.fill(password);
  await expect(emailInput).toHaveValue(email);

  const signInResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/auth/sign-in/email"),
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const signInResponse = await signInResponsePromise;
  const signInRequestBody = signInResponse.request().postDataJSON() as {
    email?: unknown;
  };
  let signInErrorBody = "";
  if (!signInResponse.ok()) {
    signInErrorBody = await signInResponse.text().catch(() => "Unable to read sign-in error body");
  }

  expect(signInRequestBody.email).toBe(email);
  expect(signInResponse.status(), signInErrorBody).toBe(200);
  await expect(page).toHaveURL(expectedPath);
}

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

let sharedAdminStorageState: Awaited<ReturnType<BrowserContext["storageState"]>> | null = null;

type SellerFixture = {
  platformContext: BrowserContext;
  platformPage: Page;
  sellerContext: BrowserContext;
  sellerPage: Page;
  vendorId: string;
  sellerEmail: string;
  sellerPassword: string;
  sellerName: string;
  sellerSlug: string;
};

async function adminApi<T>(
  page: Page,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
  expectedStatuses: number[] = [200, 201],
): Promise<T> {
  const result = await page.evaluate(async ({ method: requestMethod, path: requestPath, body: requestBody }) => {
    const response = await fetch(`/api/v1/admin${requestPath}`, {
      method: requestMethod,
      headers: requestBody === undefined ? undefined : { "content-type": "application/json" },
      body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
    });
    return { status: response.status, text: await response.text() };
  }, { method, path, body });

  expect(expectedStatuses, result.text).toContain(result.status);
  const envelope = JSON.parse(result.text) as ApiEnvelope<T>;
  expect(envelope.success, envelope.error?.message ?? result.text).toBe(true);
  return envelope.data as T;
}

async function createLocalUser(platformPage: Page, prefix: string) {
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const email = `${prefix}-${runId}@example.com`;
  const credential = `${runId}${String.fromCharCode(65, 97, 49, 33)}${runId}`;
  const name = `${prefix.replace(/-/g, " ")} ${runId}`;
  const result = await platformPage.evaluate(async ({ email, credential, name }) => {
    const response = await fetch("/api/auth/admin/create-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: credential, name, role: "user" }),
    });
    return { status: response.status, text: await response.text() };
  }, { email, credential, name });
  expect(result.status, result.text).toBe(200);
  const payload = JSON.parse(result.text) as { user?: { id?: string } };
  expect(payload.user?.id).toBeTruthy();
  return { userId: payload.user?.id as string, email, credential, name, runId };
}

async function createImpersonatedUserContext(browser: Browser, userId: string) {
  const context = await browser.newContext({ storageState: sharedAdminStorageState ?? undefined });
  const page = await context.newPage();
  await page.goto(`${adminUrl}/admin`);
  const result = await page.evaluate(async (targetUserId) => {
    const response = await fetch("/api/auth/admin/impersonate-user", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: targetUserId }),
    });
    return { status: response.status, text: await response.text() };
  }, userId);
  expect(result.status, result.text).toBe(200);
  return { context, page };
}

async function createApprovedSeller(
  browser: Browser,
  options: { approve?: boolean } = {},
): Promise<SellerFixture> {
  const platformContext = await browser.newContext(
    sharedAdminStorageState ? { storageState: sharedAdminStorageState } : {},
  );
  const platformPage = await platformContext.newPage();
  if (!sharedAdminStorageState) {
    await signIn(platformPage, adminEmail, adminPassword);
  } else {
    await platformPage.goto(`${adminUrl}/admin`);
    await expect(platformPage).toHaveURL(/\/admin(?:\/)?$/);
  }
  const seller = await createLocalUser(platformPage, "marketplace-seller");
  const impersonatedSeller = await createImpersonatedUserContext(browser, seller.userId);
  const sellerContext = impersonatedSeller.context;
  const sellerPage = impersonatedSeller.page;
  const sellerSlug = `marketplace-seller-${seller.runId}`;
  const application = await adminApi<{ vendorId: string }>(
    sellerPage,
    "POST",
    "/vendor-dashboard/application",
    {
      name: seller.name,
      slug: sellerSlug,
      legalName: `${seller.name} Ltd`,
      contactEmail: seller.email,
      contactPhone: null,
      businessAddress: "Marketplace journey business address",
      district: "Dhaka",
      upazila: null,
      pickupAddress: "Marketplace journey pickup address",
    },
  );
  if (options.approve !== false) {
    await adminApi(platformPage, "PATCH", `/vendors/${application.vendorId}/status`, {
      status: "approved",
      reason: null,
    });
  }
  await sellerPage.goto(`${adminUrl}/admin/vendor-dashboard?vendorId=${application.vendorId}`);
  if (options.approve !== false) {
    await expect(sellerPage.getByRole("tab", { name: "Overview" })).toBeVisible();
  } else {
    await expect(sellerPage.getByText("Your seller application is under platform review.")).toBeVisible();
  }
  return {
    platformContext,
    platformPage,
    sellerContext,
    sellerPage,
    vendorId: application.vendorId,
    sellerEmail: seller.email,
    sellerPassword: seller.credential,
    sellerName: seller.name,
    sellerSlug,
  };
}

async function closeSellerFixture(fixture: SellerFixture | null) {
  if (!fixture) return;
  await Promise.allSettled([fixture.sellerContext.close(), fixture.platformContext.close()]);
}

test.describe("local marketplace release smoke", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await signIn(page, adminEmail, adminPassword);
      sharedAdminStorageState = await context.storageState();
    } finally {
      await context.close();
    }
  });

  test("API, admin, and storefront become reachable together", async ({ request, page }) => {
    await expect
      .poll(() => getStatus(request, `${apiUrl}/api/v1/setup`), {
        timeout: 30_000,
        message: "API setup endpoint did not become ready",
      })
      .toBe(200);

    await expect
      .poll(() => getStatus(request, `${storefrontUrl}/favicon.svg`), {
        timeout: 30_000,
        message: "Storefront process did not become ready",
      })
      .toBe(200);

    await page.goto(`${adminUrl}/auth/login`);
    await expectLoginForm(page);
  });

  test("public vendor catalog fails closed while its feature flag is disabled", async ({
    request,
  }) => {
    const response = await request.get(`${apiUrl}/api/v1/vendors?page=1&limit=1`);

    expect(response.status()).toBe(503);
    await expect(response.text()).resolves.toContain("public_vendor_catalog");
  });

  test("seller dashboard requires an authenticated admin session", async ({ page }) => {
    await page.goto(`${adminUrl}/admin/vendor-dashboard`);

    await expect(page).toHaveURL(/\/auth\/login/);
    await expectLoginForm(page);
  });

  test("configured local admin can open the seller dashboard", async ({ browser }) => {
    const context = await browser.newContext({ storageState: sharedAdminStorageState ?? undefined });
    try {
      const page = await context.newPage();
      await page.goto(`${adminUrl}/admin/vendor-dashboard`);
      await expect(page.getByRole("heading", { name: "Seller Dashboard" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Manage vendors" })).toBeVisible();
    } finally {
      await context.close();
    }
  });

  test("seller application can be submitted, approved, and unlocked", async ({ browser }) => {
    test.setTimeout(90_000);
    const runId = randomUUID().replace(/-/g, "").slice(0, 12);
    const sellerEmail = `marketplace-e2e-${runId}@example.com`;
    const sellerCredential = `${runId}${String.fromCharCode(65, 97, 49, 33)}${runId}`;
    const sellerName = `Marketplace E2E ${runId}`;
    const sellerSlug = `marketplace-e2e-${runId}`;
    const onboardingFlagKey = "vendor_onboarding_write";
    const previousOnboardingFlag = readLocalMarketplaceFlag(onboardingFlagKey);
    writeLocalMarketplaceFlag(onboardingFlagKey, "true");
    const platformContext = await browser.newContext({
      storageState: sharedAdminStorageState ?? undefined,
    });
    const sellerContext = await browser.newContext();

    try {
      const platformPage = await platformContext.newPage();
      await platformPage.goto(`${adminUrl}/admin`);
      await expect(platformPage).toHaveURL(/\/admin(?:\/)?$/);

      const createSellerResult = await platformPage.evaluate(
        async ({ email, credential, name }) => {
          const response = await fetch("/api/auth/admin/create-user", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email, password: credential, name, role: "user" }),
          });
          return { status: response.status, body: await response.text() };
        },
        { email: sellerEmail, credential: sellerCredential, name: sellerName },
      );
      expect(createSellerResult.status, createSellerResult.body).toBe(200);

      const sellerPage = await sellerContext.newPage();
      await signIn(
        sellerPage,
        sellerEmail,
        sellerCredential,
        /\/admin\/vendor-dashboard(?:\?.*)?$/,
      );
      await expect(sellerPage.getByRole("heading", { name: "Seller Dashboard" })).toBeVisible();
      await expect(sellerPage.getByRole("link", { name: "Manage vendors" })).toHaveCount(0);
      const storeNameInput = sellerPage.getByLabel("Store name");
      await waitForReactControl(storeNameInput);
      await storeNameInput.fill(sellerName);
      await sellerPage.getByLabel("Store URL slug").fill(sellerSlug);
      await sellerPage.getByLabel("District").fill("Dhaka");
      await sellerPage.getByLabel("Business address").fill("Marketplace E2E business address");
      const submitApplication = sellerPage.getByRole("button", { name: "Submit seller application" });
      await expect(submitApplication).toBeEnabled();
      await submitApplication.click();

      await expect(
        sellerPage.getByText("Your seller application is under platform review."),
      ).toBeVisible();
      const applicationIdText = await sellerPage.getByText(/Application ID:/).textContent();
      const vendorId = applicationIdText?.replace("Application ID:", "").trim();
      expect(vendorId).toBeTruthy();

      await platformPage.goto(`${adminUrl}/admin/vendors/${vendorId}`);
      await expect(platformPage.getByRole("heading", { name: sellerName })).toBeVisible();
      const vendorStatus = platformPage.getByLabel("Vendor status");
      await waitForReactControl(vendorStatus);
      await expect(vendorStatus).toHaveValue("pending");
      const approvalResponsePromise = platformPage.waitForResponse((response) =>
        response.url().includes("/_serverFn/") && response.request().method() === "POST",
      );
      await vendorStatus.selectOption("approved");
      const approvalResponse = await approvalResponsePromise;
      expect(approvalResponse.status()).toBe(200);
      await expect(vendorStatus).toHaveValue("approved");

      await sellerPage.goto(`${adminUrl}/admin/vendor-dashboard?vendorId=${vendorId}`);
      await sellerPage.reload();
      await expect(sellerPage.getByRole("tab", { name: "Overview" })).toBeVisible();
      await expect(sellerPage.getByRole("tab", { name: "Products" })).toBeVisible();
      await expect(sellerPage.getByText(sellerName).first()).toBeVisible();
    } finally {
      try {
        writeLocalMarketplaceFlag(onboardingFlagKey, previousOnboardingFlag);
      } finally {
        await Promise.allSettled([sellerContext.close(), platformContext.close()]);
      }
    }
  });

  test("rejected seller application can be corrected, resubmitted, and approved", async ({ browser }) => {
    test.setTimeout(90_000);
    const restoreFlags = enableLocalMarketplaceFlags(["vendor_onboarding_write"]);
    let fixture: SellerFixture | null = null;
    try {
      fixture = await createApprovedSeller(browser, { approve: false });
      await adminApi(fixture.platformPage, "PATCH", `/vendors/${fixture.vendorId}/status`, {
        status: "rejected",
        reason: "Correct the pickup address",
      });
      await fixture.sellerPage.goto(`${adminUrl}/admin/vendor-dashboard?vendorId=${fixture.vendorId}`);
      await expect(fixture.sellerPage.getByText("Your seller application was rejected.")).toBeVisible();
      await expect(
        fixture.sellerPage.getByText("Correct and resubmit seller application", { exact: true }),
      ).toBeVisible();
      const businessAddress = fixture.sellerPage.getByLabel("Business address");
      await waitForReactControl(businessAddress);
      await fixture.sellerPage.getByLabel("District").fill("Dhaka");
      await businessAddress.fill("Corrected marketplace business address");
      await fixture.sellerPage.getByLabel("Pickup address").fill("Corrected marketplace pickup address");
      const responsePromise = fixture.sellerPage.waitForResponse((response) =>
        response.url().includes("/_serverFn/") && response.request().method() === "POST",
      );
      await fixture.sellerPage.getByRole("button", { name: "Resubmit seller application" }).click();
      expect((await responsePromise).status()).toBe(200);
      await expect(
        fixture.sellerPage.getByText("Your seller application is under platform review."),
      ).toBeVisible();
      await adminApi(fixture.platformPage, "PATCH", `/vendors/${fixture.vendorId}/status`, {
        status: "approved",
        reason: null,
      });
      await fixture.sellerPage.reload();
      await expect(fixture.sellerPage.getByRole("tab", { name: "Products" })).toBeVisible();
    } finally {
      restoreFlags();
      await closeSellerFixture(fixture);
    }
  });

  test("approved seller can publish a public store profile", async ({ browser }) => {
    test.setTimeout(120_000);
    const restoreFlags = enableLocalMarketplaceFlags([
      "vendor_onboarding_write",
      "vendor_catalog_write",
      "public_vendor_catalog",
    ]);
    let fixture: SellerFixture | null = null;
    try {
      fixture = await createApprovedSeller(browser);
      await fixture.sellerPage.getByRole("tab", { name: "Store profile" }).click();
      const description = fixture.sellerPage.getByLabel("Seller description");
      await waitForReactControl(description);
      const publicDescription = `Trusted marketplace profile ${fixture.sellerSlug}`;
      await description.fill(publicDescription);
      await fixture.sellerPage.getByLabel("SEO title").fill(`${fixture.sellerName} marketplace store`);
      await fixture.sellerPage.getByLabel("Publication state").selectOption("published");
      const saveResponsePromise = fixture.sellerPage.waitForResponse((response) =>
        response.url().includes("/_serverFn/") && response.request().method() === "POST",
      );
      await fixture.sellerPage.getByRole("button", { name: "Save store profile" }).click();
      expect((await saveResponsePromise).status()).toBe(200);
      const profile = await adminApi<{ publicationStatus: string; description: string | null }>(
        fixture.sellerPage,
        "GET",
        `/vendor-dashboard/profile?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      expect(profile.publicationStatus).toBe("published");
      expect(profile.description).toBe(publicDescription);

      const publicPage = await fixture.sellerContext.newPage();
      await publicPage.goto(`${storefrontUrl}/vendors/${fixture.sellerSlug}`);
      await expect(publicPage.getByText(fixture.sellerName).first()).toBeVisible();
      await expect(publicPage.getByText(publicDescription)).toBeVisible();
    } finally {
      restoreFlags();
      await closeSellerFixture(fixture);
    }
  });

  test("seller team invitation can be accepted, changed, suspended, and revoked", async ({ browser }) => {
    test.setTimeout(120_000);
    const restoreFlags = enableLocalMarketplaceFlags(["vendor_onboarding_write"]);
    let fixture: SellerFixture | null = null;
    let memberContext: BrowserContext | null = null;
    try {
      fixture = await createApprovedSeller(browser);
      const member = await createLocalUser(fixture.platformPage, "marketplace-member");
      await fixture.sellerPage.getByRole("tab", { name: "Team" }).click();
      const inviteeEmail = fixture.sellerPage.getByLabel("Invitee email");
      await waitForReactControl(inviteeEmail);
      await inviteeEmail.fill(member.email);
      await fixture.sellerPage.getByLabel("Role").selectOption("catalog");
      const inviteResponsePromise = fixture.sellerPage.waitForResponse((response) =>
        response.url().includes("/_serverFn/") && response.request().method() === "POST",
      );
      await fixture.sellerPage.getByRole("button", { name: "Create invitation" }).click();
      expect((await inviteResponsePromise).status()).toBe(200);
      const token = await fixture.sellerPage.locator("input[readonly]").last().inputValue();
      expect(token.length).toBeGreaterThan(20);

      const impersonatedMember = await createImpersonatedUserContext(browser, member.userId);
      memberContext = impersonatedMember.context;
      const memberPage = impersonatedMember.page;
      await memberPage.goto(`${adminUrl}/admin/vendor-dashboard`);
      const credentialInput = memberPage.getByLabel("Seller invitation credential");
      await waitForReactControl(credentialInput);
      await credentialInput.fill(token);
      const acceptResponsePromise = memberPage.waitForResponse((response) =>
        response.url().includes("/_serverFn/") && response.request().method() === "POST",
      );
      await memberPage.getByRole("button", { name: "Accept invitation" }).click();
      expect((await acceptResponsePromise).status()).toBe(200);
      await expect(memberPage.getByRole("combobox").first()).toHaveValue(fixture.vendorId);
      await expect(memberPage.getByRole("tab", { name: "Products" })).toBeVisible();
      await expect(memberPage.getByRole("tab", { name: "Team" })).toHaveCount(0);

      const team = await adminApi<{
        members: Array<{ membershipId: string; email: string; role: string; status: string }>;
      }>(
        fixture.sellerPage,
        "GET",
        `/vendor-dashboard/team?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      const acceptedMember = team.members.find((candidate) => candidate.email === member.email);
      expect(acceptedMember).toBeTruthy();
      const membershipId = acceptedMember?.membershipId as string;
      const changed = await adminApi<{ role: string; status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/team/members/${encodeURIComponent(membershipId)}`,
        { vendorId: fixture.vendorId, role: "fulfillment" },
      );
      expect(changed.role).toBe("fulfillment");
      const suspended = await adminApi<{ status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/team/members/${encodeURIComponent(membershipId)}`,
        { vendorId: fixture.vendorId, status: "suspended" },
      );
      expect(suspended.status).toBe("suspended");
      const reactivated = await adminApi<{ status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/team/members/${encodeURIComponent(membershipId)}`,
        { vendorId: fixture.vendorId, status: "active" },
      );
      expect(reactivated.status).toBe("active");
      const revoked = await adminApi<{ status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/team/members/${encodeURIComponent(membershipId)}`,
        { vendorId: fixture.vendorId, status: "revoked" },
      );
      expect(revoked.status).toBe("revoked");
      await memberPage.reload();
      await expect(memberPage.getByRole("combobox").first()).toHaveValue("");
      await expect(memberPage.getByRole("tab", { name: "Products" })).toHaveCount(0);
    } finally {
      restoreFlags();
      await Promise.allSettled([
        memberContext?.close(),
        closeSellerFixture(fixture),
      ]);
    }
  });

  test("checkout, fulfillment, settlement, payout, and refund complete end to end", async ({
    browser,
    request,
  }) => {
    test.setTimeout(180_000);
    const restoreFlags = enableLocalMarketplaceFlags([
      "vendor_onboarding_write",
      "vendor_catalog_write",
      "public_vendor_catalog",
      "seller_order_actions",
      "vendor_shipments",
      "ledger_posting",
      "settlement_release",
      "payout_write",
    ]);
    let fixture: SellerFixture | null = null;
    try {
      fixture = await createApprovedSeller(browser);
      runLocalWrangler([
        "d1",
        "execute",
        "marketplace-local-db",
        ...localWranglerArgs,
        "--command",
        `UPDATE vendors SET settlement_hold_days = 0 WHERE id = '${fixture.vendorId}'`,
      ]);

      const locationSuffix = randomUUID().replace(/-/g, "").slice(0, 8);
      const city = await adminApi<{ location: { id: string } }>(
        fixture.platformPage,
        "POST",
        "/settings/delivery-locations",
        {
          name: `E2E City ${locationSuffix}`,
          type: "city",
          parentId: null,
          externalIds: {},
          metadata: {},
          isActive: true,
          sortOrder: 0,
        },
      );
      const zone = await adminApi<{ location: { id: string } }>(
        fixture.platformPage,
        "POST",
        "/settings/delivery-locations",
        {
          name: `E2E Zone ${locationSuffix}`,
          type: "zone",
          parentId: city.location.id,
          externalIds: {},
          metadata: {},
          isActive: true,
          sortOrder: 0,
        },
      );
      const shipping = await adminApi<{ shippingMethod: { id: string; fee: number } }>(
        fixture.platformPage,
        "POST",
        "/settings/shipping-methods",
        {
          name: `E2E Shipping ${locationSuffix}`,
          fee: 100,
          description: "Local marketplace release journey",
          isActive: true,
          sortOrder: 0,
        },
      );

      const categorySlug = `e2e-ops-category-${locationSuffix}`;
      const category = await adminApi<{ id: string }>(fixture.platformPage, "POST", "/categories", {
        name: `E2E Ops Category ${locationSuffix}`,
        description: "Operational marketplace E2E category",
        slug: categorySlug,
        metaTitle: null,
        metaDescription: null,
        image: null,
      });
      const productSlug = `e2e-ops-product-${locationSuffix}`;
      const productName = `Marketplace Operations Product ${locationSuffix}`;
      const createdProduct = await adminApi<{ productId: string }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/products?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          name: productName,
          description: "Operational marketplace product for checkout and fulfillment testing.",
          price: 1250,
          categoryId: category.id,
          isActive: true,
          discountType: "percentage",
          discountPercentage: 0,
          discountAmount: 0,
          freeDelivery: false,
          metaTitle: productName,
          metaDescription: "Operational marketplace E2E product",
          slug: productSlug,
          images: [],
          attributes: [],
          additionalInfo: [],
        },
      );
      await adminApi(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/products/${encodeURIComponent(createdProduct.productId)}/submit?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      await adminApi(
        fixture.platformPage,
        "PATCH",
        `/products/${encodeURIComponent(createdProduct.productId)}/approval-status`,
        { approvalStatus: "approved", reason: "Operational E2E approval" },
      );
      const variants = await adminApi<{
        variants: Array<{
          id: string;
          size: string | null;
          color: string | null;
          weight: number | null;
          sku: string;
          price: number;
          trackInventory: boolean;
          barcode: string | null;
          barcodeType: string | null;
          discountType: "percentage" | "flat" | null;
          discountPercentage: number | null;
          discountAmount: number | null;
        }>;
      }>(
        fixture.sellerPage,
        "GET",
        `/vendor-dashboard/products/${encodeURIComponent(createdProduct.productId)}/variants?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      const variant = variants.variants[0];
      expect(variant).toBeTruthy();
      const inventoryUpdate = await adminApi<{ approvalStatus: string }>(
        fixture.sellerPage,
        "PUT",
        `/vendor-dashboard/products/${encodeURIComponent(createdProduct.productId)}/variants/${encodeURIComponent(variant.id)}?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          size: variant.size,
          color: variant.color,
          weight: variant.weight,
          sku: variant.sku,
          price: variant.price,
          stock: 10,
          trackInventory: true,
          barcode: variant.barcode,
          barcodeType: variant.barcodeType,
          discountType: variant.discountType ?? "percentage",
          discountPercentage: variant.discountPercentage ?? 0,
          discountAmount: variant.discountAmount ?? 0,
        },
      );
      if (inventoryUpdate.approvalStatus !== "approved") {
        await adminApi(
          fixture.platformPage,
          "PATCH",
          `/products/${encodeURIComponent(createdProduct.productId)}/approval-status`,
          { approvalStatus: "approved", reason: "Operational inventory E2E approval" },
        );
      }

      const customerPhone = `+88018${String(Date.now()).slice(-8)}`;
      const orderResponse = await request.post(`${apiUrl}/api/v1/orders`, {
        data: {
          checkoutRequestId: `checkout-e2e-${locationSuffix}-${Date.now()}`,
          customerName: "Marketplace E2E Customer",
          customerPhone,
          customerEmail: null,
          shippingAddress: "Marketplace E2E customer delivery address",
          city: city.location.id,
          zone: zone.location.id,
          area: null,
          cityName: `E2E City ${locationSuffix}`,
          zoneName: `E2E Zone ${locationSuffix}`,
          areaName: null,
          notes: "Operational marketplace release journey",
          items: [{
            cartKey: `e2e:${variant.id}`,
            productId: createdProduct.productId,
            variantId: variant.id,
            quantity: 1,
            price: 1250,
            productName,
            variantLabel: null,
          }],
          discountAmount: 0,
          discountCode: null,
          shippingCharge: shipping.shippingMethod.fee,
          shippingMethodId: shipping.shippingMethod.id,
          paymentMethod: "cod",
          inventoryPool: "regular",
        },
      });
      expect(orderResponse.status(), await orderResponse.text()).toBe(201);
      const orderEnvelope = await orderResponse.json() as ApiEnvelope<{
        orderId: string;
        totalAmount: number;
      }>;
      const orderId = orderEnvelope.data?.orderId as string;
      const totalAmount = orderEnvelope.data?.totalAmount as number;
      expect(orderId).toBeTruthy();
      expect(totalAmount).toBe(1350);

      let vendorOrder: { id: string; version: number; status: string } | undefined;
      await expect.poll(async () => {
        const payload = await adminApi<{
          orders: Array<{ id: string; orderId: string; version: number; status: string }>;
        }>(
          fixture!.sellerPage,
          "GET",
          `/vendor-dashboard/orders?vendorId=${encodeURIComponent(fixture!.vendorId)}&page=1&limit=20`,
        );
        vendorOrder = payload.orders.find((candidate) => candidate.orderId === orderId);
        return vendorOrder?.status;
      }, { timeout: 15_000 }).toBe("pending");

      const processing = await adminApi<{ version: number; status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/orders/${encodeURIComponent(vendorOrder!.id)}/status?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        { expectedVersion: vendorOrder!.version, status: "processing" },
      );
      const ready = await adminApi<{ version: number; status: string }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/orders/${encodeURIComponent(vendorOrder!.id)}/status?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        { expectedVersion: processing.version, status: "ready" },
      );
      expect(ready.status).toBe("ready");
      const vendorOrderDetail = await adminApi<{
        items: Array<{ id: string; quantity: number }>;
      }>(
        fixture.sellerPage,
        "GET",
        `/vendor-dashboard/orders/${encodeURIComponent(vendorOrder!.id)}?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      const shipment = await adminApi<{ shipmentId: string; status: string; version: number }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/orders/${encodeURIComponent(vendorOrder!.id)}/shipments?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          idempotencyKey: `e2e-shipment-${locationSuffix}`,
          items: vendorOrderDetail.items.map((item) => ({
            orderItemId: item.id,
            quantity: item.quantity,
          })),
          providerId: null,
          providerType: "manual",
          trackingId: `TRACK-${locationSuffix}`,
          trackingUrl: null,
          courierName: "Marketplace E2E Courier",
          note: "Operational marketplace shipment",
          shipmentAmountMinor: 10000,
          isFinalShipment: true,
        },
      );
      const shipmentProcessing = await adminApi<{ status: string; version: number }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/shipments/${encodeURIComponent(shipment.shipmentId)}/status?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        { expectedVersion: shipment.version, status: "processing" },
      );
      const shipmentTransit = await adminApi<{ status: string; version: number }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/shipments/${encodeURIComponent(shipment.shipmentId)}/status?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        { expectedVersion: shipmentProcessing.version, status: "in_transit" },
      );
      const shipmentDelivered = await adminApi<{ status: string; version: number }>(
        fixture.sellerPage,
        "PATCH",
        `/vendor-dashboard/shipments/${encodeURIComponent(shipment.shipmentId)}/status?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        { expectedVersion: shipmentTransit.version, status: "delivered" },
      );
      expect(shipmentDelivered.status).toBe("delivered");

      await adminApi(
        fixture.platformPage,
        "POST",
        `/orders/${encodeURIComponent(orderId)}/cod`,
        {
          action: "collected",
          collectedBy: "Marketplace E2E Courier",
          collectedAmount: totalAmount,
        },
      );
      const processedOutbox = await adminApi<{ enabled: boolean; processed: number }>(
        fixture.platformPage,
        "POST",
        "/marketplace-finance/outbox/process",
        { limit: 100 },
      );
      expect(processedOutbox.enabled).toBe(true);
      const settlement = await adminApi<{ amountMinor: number; currency: string }>(
        fixture.platformPage,
        "POST",
        `/marketplace-finance/settlements/${encodeURIComponent(vendorOrder!.id)}/release`,
      );
      expect(settlement.amountMinor).toBeGreaterThan(0);

      const destinationNumber = `019${String(Date.now()).slice(-8)}`;
      const payoutMethod = await adminApi<{ id: string }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/payout-methods?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          method: "bkash",
          displayName: "Operational E2E bKash",
          providerName: "bKash",
          isDefault: true,
          destination: {
            accountName: fixture.sellerName,
            phoneNumber: destinationNumber,
          },
        },
      );
      await adminApi(
        fixture.platformPage,
        "PATCH",
        `/marketplace-finance/payout-methods/${encodeURIComponent(payoutMethod.id)}/status`,
        { status: "verified", reason: null },
      );
      const preview = await adminApi<{ eligibleMinor: number; currency?: string }>(
        fixture.platformPage,
        "POST",
        "/marketplace-finance/payouts/preview",
        {
          vendorId: fixture.vendorId,
          currency: settlement.currency,
          payoutMethodId: payoutMethod.id,
        },
      );
      expect(preview.eligibleMinor).toBeGreaterThan(0);
      const reservation = await adminApi<{ payoutItemId: string; amountMinor: number }>(
        fixture.platformPage,
        "POST",
        "/marketplace-finance/payouts/reserve",
        {
          idempotencyKey: `e2e-payout-${locationSuffix}`,
          vendorId: fixture.vendorId,
          currency: settlement.currency,
          amountMinor: preview.eligibleMinor,
          payoutMethodId: payoutMethod.id,
          notes: "Operational marketplace E2E payout",
        },
      );
      const claimed = await adminApi<{ status: string }>(
        fixture.platformPage,
        "POST",
        `/marketplace-finance/payouts/${encodeURIComponent(reservation.payoutItemId)}/claim`,
        { provider: "manual", requestMetadata: { source: "e2e" } },
      );
      expect(claimed.status).toBe("processing");
      const completed = await adminApi<{ status: string }>(
        fixture.platformPage,
        "POST",
        `/marketplace-finance/payouts/${encodeURIComponent(reservation.payoutItemId)}/complete`,
        {
          providerReference: `MANUAL-${locationSuffix}`,
          responseMetadata: { source: "e2e" },
        },
      );
      expect(completed.status).toBe("completed");

      const refund = await adminApi<{ success: boolean; isFullRefund: boolean }>(
        fixture.platformPage,
        "POST",
        `/orders/${encodeURIComponent(orderId)}/refund`,
        {
          amount: totalAmount,
          reason: "Marketplace operational E2E full refund",
          gateway: "cod",
        },
      );
      expect(refund.success).toBe(true);
      expect(refund.isFullRefund).toBe(true);
      await adminApi(
        fixture.platformPage,
        "POST",
        "/marketplace-finance/outbox/process",
        { limit: 100 },
      );
      const balances = await adminApi<{
        balances: Array<{ paidMinor: number; debtMinor: number }>;
      }>(
        fixture.platformPage,
        "GET",
        `/marketplace-finance/vendors/${encodeURIComponent(fixture.vendorId)}/balances`,
      );
      expect(balances.balances.some((balance) => balance.paidMinor > 0)).toBe(true);
      expect(balances.balances.some((balance) => balance.debtMinor > 0)).toBe(true);
    } finally {
      restoreFlags();
      await closeSellerFixture(fixture);
    }
  });

  test("seller product and payout destination complete platform moderation", async ({ browser }) => {
    test.setTimeout(120_000);
    const restoreFlags = enableLocalMarketplaceFlags([
      "vendor_onboarding_write",
      "vendor_catalog_write",
      "public_vendor_catalog",
      "payout_write",
    ]);
    let fixture: SellerFixture | null = null;
    try {
      fixture = await createApprovedSeller(browser);
      await adminApi(fixture.sellerPage, "PUT", "/vendor-dashboard/profile", {
        vendorId: fixture.vendorId,
        description: `Catalog seller ${fixture.sellerSlug}`,
        logoMediaId: null,
        bannerMediaId: null,
        showContactEmail: false,
        showContactPhone: false,
        seoTitle: fixture.sellerName,
        seoDescription: null,
        returnPolicy: "Returns accepted within seven days.",
        supportHours: "Sat-Thu, 9am-6pm",
        publicationStatus: "published",
      });

      const categorySlug = `e2e-category-${randomUUID().replace(/-/g, "").slice(0, 8)}`;
      const category = await adminApi<{ id: string }>(fixture.platformPage, "POST", "/categories", {
        name: `E2E Category ${categorySlug}`,
        description: "Marketplace E2E category",
        slug: categorySlug,
        metaTitle: null,
        metaDescription: null,
        image: null,
      });
      const productSlug = `e2e-product-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
      const productName = `Marketplace Product ${productSlug}`;
      const createdProduct = await adminApi<{ productId: string; approvalStatus: string }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/products?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          name: productName,
          description: "A complete marketplace end to end product description.",
          price: 1250,
          categoryId: category.id,
          isActive: true,
          discountType: "percentage",
          discountPercentage: 0,
          discountAmount: 0,
          freeDelivery: false,
          metaTitle: productName,
          metaDescription: "Marketplace E2E product",
          slug: productSlug,
          images: [],
          attributes: [],
          additionalInfo: [],
        },
      );
      expect(createdProduct.approvalStatus).toBe("draft");
      const submittedProduct = await adminApi<{ approvalStatus: string }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/products/${encodeURIComponent(createdProduct.productId)}/submit?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      expect(submittedProduct.approvalStatus).toBe("submitted");
      const moderated = await adminApi<{ product: { approvalStatus: string; isActive: boolean } }>(
        fixture.platformPage,
        "PATCH",
        `/products/${encodeURIComponent(createdProduct.productId)}/approval-status`,
        { approvalStatus: "approved", reason: "E2E approval" },
      );
      expect(moderated.product.approvalStatus).toBe("approved");
      expect(moderated.product.isActive).toBe(true);

      await fixture.sellerPage.goto(`${adminUrl}/admin/vendor-dashboard?vendorId=${fixture.vendorId}`);
      await fixture.sellerPage.getByRole("tab", { name: "Products" }).click();
      await expect(fixture.sellerPage.getByText(productName)).toBeVisible();
      await expect(fixture.sellerPage.getByText("approved", { exact: true })).toBeVisible();
      const publicVendorPage = await fixture.sellerContext.newPage();
      await publicVendorPage.goto(`${storefrontUrl}/vendors/${fixture.sellerSlug}`);
      await expect(publicVendorPage.getByText(productName)).toBeVisible();

      const destinationNumber = `017${String(Date.now()).slice(-8)}`;
      const payoutMethod = await adminApi<{ id: string; status: string }>(
        fixture.sellerPage,
        "POST",
        `/vendor-dashboard/payout-methods?vendorId=${encodeURIComponent(fixture.vendorId)}`,
        {
          method: "bkash",
          displayName: "Marketplace E2E bKash",
          providerName: "bKash",
          isDefault: true,
          destination: {
            accountName: fixture.sellerName,
            phoneNumber: destinationNumber,
          },
        },
      );
      expect(payoutMethod.status).toBe("pending");
      const verifiedPayout = await adminApi<{ id: string; status: string }>(
        fixture.platformPage,
        "PATCH",
        `/marketplace-finance/payout-methods/${encodeURIComponent(payoutMethod.id)}/status`,
        { status: "verified", reason: null },
      );
      expect(verifiedPayout.status).toBe("verified");
      const payoutMethods = await adminApi<{
        payoutMethods: Array<{ id: string; status: string; lastFour: string | null }>;
      }>(
        fixture.sellerPage,
        "GET",
        `/vendor-dashboard/payout-methods?vendorId=${encodeURIComponent(fixture.vendorId)}`,
      );
      const verifiedMethod = payoutMethods.payoutMethods.find((method) => method.id === payoutMethod.id);
      expect(verifiedMethod?.status).toBe("verified");
      expect(verifiedMethod?.lastFour).toBe(destinationNumber.slice(-4));
    } finally {
      restoreFlags();
      await closeSellerFixture(fixture);
    }
  });
});
