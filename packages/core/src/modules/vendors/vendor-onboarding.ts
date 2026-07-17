import { safeBatch, type Database } from "@scalius/database/client";
import {
  vendorAddresses,
  vendorCommissionRules,
  vendorModerationEvents,
  vendorUsers,
  vendors,
} from "@scalius/database/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ConflictError, ValidationError } from "../../errors";
import { assertVendorStatusTransition } from "./vendor-state-machine";

export interface VendorOnboardingDependencies {
  now: () => Date;
  id: () => string;
}

const defaultDependencies: VendorOnboardingDependencies = {
  now: () => new Date(),
  id: () => crypto.randomUUID(),
};

export interface VendorApplicationInput {
  applicantUserId: string;
  name: string;
  slug: string;
  legalName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  businessAddress: string;
  district: string;
  upazila?: string | null;
  pickupAddress?: string | null;
}

export interface VendorApplicationResult {
  vendorId: string;
  status: "pending" | "rejected";
  replayed: boolean;
}

function emptyToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeApplication(input: VendorApplicationInput) {
  const applicantUserId = input.applicantUserId.trim();
  const name = input.name.trim();
  const slug = input.slug.trim().toLowerCase();
  const businessAddress = input.businessAddress.trim();
  const district = input.district.trim();
  const pickupAddress = input.pickupAddress?.trim() || businessAddress;

  if (!applicantUserId) throw new ValidationError("Authenticated applicant is required");
  if (!name || name.length > 160) throw new ValidationError("Seller name is required and must be 160 characters or fewer");
  if (slug.length < 3 || slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ValidationError("Seller slug must use lowercase letters, numbers, and single hyphens");
  }
  if (!businessAddress || businessAddress.length > 500) {
    throw new ValidationError("Business address is required and must be 500 characters or fewer");
  }
  if (!district || district.length > 120) {
    throw new ValidationError("District is required and must be 120 characters or fewer");
  }
  if (pickupAddress.length > 500) {
    throw new ValidationError("Pickup address must be 500 characters or fewer");
  }

  return {
    applicantUserId,
    name,
    slug,
    legalName: emptyToNull(input.legalName),
    contactEmail: emptyToNull(input.contactEmail),
    contactPhone: emptyToNull(input.contactPhone),
    businessAddress,
    district,
    upazila: emptyToNull(input.upazila),
    pickupAddress,
  };
}

async function readExistingOwnerApplication(db: Database, userId: string) {
  const memberships = await db
    .select({ vendorId: vendorUsers.vendorId })
    .from(vendorUsers)
    .where(and(
      eq(vendorUsers.userId, userId),
      eq(vendorUsers.role, "owner"),
      eq(vendorUsers.status, "active"),
    ))
    .limit(1);
  const membership = memberships[0];
  if (!membership) return null;

  const rows = await db
    .select({ id: vendors.id, status: vendors.status, slug: vendors.slug })
    .from(vendors)
    .where(and(eq(vendors.id, membership.vendorId), isNull(vendors.deletedAt)))
    .limit(1);
  return rows[0] ?? null;
}

function isVendorSlugConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed: vendors.slug") ||
    message.includes("vendors_slug_idx");
}

function isOwnerPerUserConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("UNIQUE constraint failed: vendor_users.user_id") ||
    message.includes("vendor_users_one_active_owner_per_user_idx");
}

type NormalizedVendorApplication = ReturnType<typeof normalizeApplication>;

async function resubmitRejectedVendorApplication(
  db: Database,
  existing: { id: string; status: "rejected"; slug: string },
  input: NormalizedVendorApplication,
  dependencies: VendorOnboardingDependencies,
): Promise<VendorApplicationResult> {
  assertVendorStatusTransition(existing.status, "pending");

  const duplicateSlug = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.slug, input.slug))
    .limit(1);
  if (duplicateSlug.some((row) => row.id !== existing.id)) {
    throw new ConflictError("This seller URL is already reserved");
  }

  const addressRows = await db
    .select({ id: vendorAddresses.id, type: vendorAddresses.type })
    .from(vendorAddresses)
    .where(and(
      eq(vendorAddresses.vendorId, existing.id),
      isNull(vendorAddresses.deletedAt),
    ));
  const businessAddress = addressRows.find((row) => row.type === "business");
  const pickupAddress = addressRows.find((row) => row.type === "pickup");
  const now = dependencies.now();

  const addressWrite = (
    type: "business" | "pickup",
    addressId: string | undefined,
    addressLine1: string,
    label: string,
  ) => addressId
    ? db.update(vendorAddresses)
      .set({
        label,
        phone: input.contactPhone,
        addressLine1,
        district: input.district,
        upazila: input.upazila,
        countryCode: "BD",
        isDefault: true,
        updatedAt: now,
      })
      .where(and(
        eq(vendorAddresses.id, addressId),
        eq(vendorAddresses.vendorId, existing.id),
        isNull(vendorAddresses.deletedAt),
      ))
    : db.insert(vendorAddresses).values({
      id: dependencies.id(),
      vendorId: existing.id,
      type,
      label,
      phone: input.contactPhone,
      addressLine1,
      district: input.district,
      upazila: input.upazila,
      countryCode: "BD",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    });

  const writes = [
    db.update(vendors)
      .set({
        name: input.name,
        slug: input.slug,
        legalName: input.legalName,
        status: "pending",
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        updatedAt: now,
      })
      .where(and(
        eq(vendors.id, existing.id),
        eq(vendors.status, "rejected"),
        isNull(vendors.deletedAt),
      )),
    addressWrite("business", businessAddress?.id, input.businessAddress, "Business"),
    addressWrite("pickup", pickupAddress?.id, input.pickupAddress, "Pickup"),
    db.insert(vendorModerationEvents).values({
      id: dependencies.id(),
      vendorId: existing.id,
      fromStatus: "rejected",
      toStatus: "pending",
      reason: "Seller application corrected and resubmitted",
      actorUserId: input.applicantUserId,
      metadata: { source: "seller_application_resubmission" },
      createdAt: now,
    }),
  ];

  try {
    await safeBatch(db, writes as never[]);
  } catch (error: unknown) {
    if (isVendorSlugConstraint(error)) {
      throw new ConflictError("This seller URL was reserved by another application");
    }
    throw error;
  }

  return { vendorId: existing.id, status: "pending", replayed: false };
}

export async function applyForVendor(
  db: Database,
  rawInput: VendorApplicationInput,
  dependencies: VendorOnboardingDependencies = defaultDependencies,
): Promise<VendorApplicationResult> {
  const input = normalizeApplication(rawInput);
  const existing = await readExistingOwnerApplication(db, input.applicantUserId);
  if (existing) {
    if (existing.status === "pending") {
      return { vendorId: existing.id, status: existing.status, replayed: true };
    }
    if (existing.status === "rejected") {
      return resubmitRejectedVendorApplication(db, {
        id: existing.id,
        status: "rejected",
        slug: existing.slug,
      }, input, dependencies);
    }
    throw new ValidationError("This account already owns a seller store");
  }

  const duplicateSlug = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(eq(vendors.slug, input.slug))
    .limit(1);
  if (duplicateSlug.length > 0) {
    throw new ConflictError("This seller URL is already reserved");
  }

  const vendorId = dependencies.id();
  const now = dependencies.now();
  const writes = [
    db.insert(vendors).values({
      id: vendorId,
      name: input.name,
      slug: input.slug,
      legalName: input.legalName,
      status: "pending",
      contactEmail: input.contactEmail,
      contactPhone: input.contactPhone,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(vendorUsers).values({
      id: dependencies.id(),
      vendorId,
      userId: input.applicantUserId,
      role: "owner",
      status: "active",
      invitedAt: now,
      acceptedAt: now,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(vendorCommissionRules).values({
      id: dependencies.id(),
      scope: "vendor",
      vendorId,
      rateBps: 0,
      status: "active",
      priority: 100,
      effectiveFrom: now,
      createdBy: input.applicantUserId,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(vendorAddresses).values({
      id: dependencies.id(),
      vendorId,
      type: "business",
      label: "Business",
      phone: input.contactPhone,
      addressLine1: input.businessAddress,
      district: input.district,
      upazila: input.upazila,
      countryCode: "BD",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(vendorAddresses).values({
      id: dependencies.id(),
      vendorId,
      type: "pickup",
      label: "Pickup",
      phone: input.contactPhone,
      addressLine1: input.pickupAddress,
      district: input.district,
      upazila: input.upazila,
      countryCode: "BD",
      isDefault: true,
      createdAt: now,
      updatedAt: now,
    }),
    db.insert(vendorModerationEvents).values({
      id: dependencies.id(),
      vendorId,
      fromStatus: null,
      toStatus: "pending",
      reason: "Seller application submitted",
      actorUserId: input.applicantUserId,
      metadata: { source: "seller_application" },
      createdAt: now,
    }),
  ];

  try {
    await safeBatch(db, writes as never[]);
  } catch (error: unknown) {
    if (isVendorSlugConstraint(error)) {
      throw new ConflictError("This seller URL was reserved by another application");
    }
    if (isOwnerPerUserConstraint(error)) {
      throw new ConflictError("This account already owns or is creating another seller store");
    }
    throw error;
  }

  return { vendorId, status: "pending", replayed: false };
}
