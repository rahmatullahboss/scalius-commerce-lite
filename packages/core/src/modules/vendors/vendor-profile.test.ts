import { describe, expect, it, vi } from "vitest";
import type { VendorMembershipContext } from "../../auth/vendor-context";
import { ValidationError } from "../../errors";
import { getVendorProfile, upsertVendorProfile } from "./vendor-profile";

type Statement = { kind: "insert" | "update"; values: Record<string, unknown> };

function createDb(selectResults: unknown[][]) {
  const queued = [...selectResults];
  const batches: Statement[][] = [];

  function selectChain(result: unknown[]) {
    const chain = {
      leftJoin: () => chain,
      where: () => chain,
      limit: () => chain,
      all: async () => result,
      then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(result).then(resolve),
    };
    return chain;
  }

  const db = {
    select: vi.fn(() => ({ from: vi.fn(() => selectChain(queued.shift() ?? [])) })),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => ({ kind: "insert", values } satisfies Statement)),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => ({
        where: vi.fn(() => ({ kind: "update", values } satisfies Statement)),
      })),
    })),
    batch: vi.fn(async (statements: Statement[]) => {
      batches.push(statements);
      return statements.map(() => []);
    }),
  };
  return { db, batches };
}

const ownerContext: VendorMembershipContext = {
  membershipId: "membership_owner",
  vendorId: "vendor_1",
  userId: "owner_1",
  role: "owner",
  membershipStatus: "active",
  vendorStatus: "approved",
  vendorName: "Seller One",
  vendorSlug: "seller-one",
};

const catalogContext: VendorMembershipContext = { ...ownerContext, role: "catalog" };
const now = new Date("2026-07-14T12:00:00.000Z");

describe("vendor profile management", () => {
  it("returns a default draft profile without exposing other sellers", async () => {
    const { db } = createDb([[
      { contactEmail: "seller@example.com", contactPhone: "+8801700000000", vendorId: "vendor_1" },
    ]]);

    await expect(getVendorProfile(db as never, ownerContext)).resolves.toMatchObject({
      vendorId: "vendor_1",
      contactEmail: "seller@example.com",
      publicationStatus: "draft",
      description: null,
      showContactEmail: false,
    });
  });

  it("creates a normalized profile after validating active media references", async () => {
    const { db, batches } = createDb([
      [{ contactEmail: "seller@example.com", contactPhone: "+8801700000000" }],
      [{ id: "media_logo" }, { id: "media_banner" }],
      [],
    ]);

    await expect(upsertVendorProfile(db as never, ownerContext, {
      description: "  Seller description  ",
      logoMediaId: "media_logo",
      bannerMediaId: "media_banner",
      showContactEmail: true,
      showContactPhone: false,
      seoTitle: " Seller SEO ",
      seoDescription: " Seller SEO description ",
      returnPolicy: " Return within seven days. ",
      supportHours: " Sat–Thu, 9am–6pm ",
      publicationStatus: "published",
    }, { now: () => now })).resolves.toMatchObject({
      vendorId: "vendor_1",
      description: "Seller description",
      logoMediaId: "media_logo",
      bannerMediaId: "media_banner",
      publicationStatus: "published",
    });

    expect(batches).toHaveLength(1);
    expect(batches[0]?.[0]).toMatchObject({
      kind: "insert",
      values: {
        vendorId: "vendor_1",
        description: "Seller description",
        publicationStatus: "published",
      },
    });
  });

  it("updates an existing profile without changing seller lifecycle authority", async () => {
    const { db, batches } = createDb([
      [{ contactEmail: null, contactPhone: null }],
      [{ vendorId: "vendor_1", createdAt: new Date("2026-07-13T12:00:00.000Z") }],
    ]);
    await upsertVendorProfile(db as never, ownerContext, {
      description: null,
      logoMediaId: null,
      bannerMediaId: null,
      showContactEmail: false,
      showContactPhone: false,
      seoTitle: null,
      seoDescription: null,
      returnPolicy: null,
      supportHours: null,
      publicationStatus: "draft",
    }, { now: () => now });

    expect(batches[0]?.[0]).toMatchObject({
      kind: "update",
      values: { publicationStatus: "draft", updatedAt: now },
    });
    expect(batches[0]?.[0]?.values).not.toHaveProperty("status");
  });

  it("rejects unauthorized roles, invalid media, and oversized public content", async () => {
    const denied = createDb([]);
    await expect(upsertVendorProfile(denied.db as never, catalogContext, {
      description: null,
      logoMediaId: null,
      bannerMediaId: null,
      showContactEmail: false,
      showContactPhone: false,
      seoTitle: null,
      seoDescription: null,
      returnPolicy: null,
      supportHours: null,
      publicationStatus: "draft",
    }, { now: () => now })).rejects.toBeInstanceOf(ValidationError);

    const invalidMedia = createDb([
      [{ contactEmail: null, contactPhone: null }],
      [{ id: "media_logo" }],
    ]);
    await expect(upsertVendorProfile(invalidMedia.db as never, ownerContext, {
      description: null,
      logoMediaId: "media_logo",
      bannerMediaId: "media_missing",
      showContactEmail: false,
      showContactPhone: false,
      seoTitle: null,
      seoDescription: null,
      returnPolicy: null,
      supportHours: null,
      publicationStatus: "draft",
    }, { now: () => now })).rejects.toBeInstanceOf(ValidationError);

    const oversized = createDb([]);
    await expect(upsertVendorProfile(oversized.db as never, ownerContext, {
      description: "x".repeat(5001),
      logoMediaId: null,
      bannerMediaId: null,
      showContactEmail: false,
      showContactPhone: false,
      seoTitle: null,
      seoDescription: null,
      returnPolicy: null,
      supportHours: null,
      publicationStatus: "draft",
    }, { now: () => now })).rejects.toBeInstanceOf(ValidationError);
  });
});
