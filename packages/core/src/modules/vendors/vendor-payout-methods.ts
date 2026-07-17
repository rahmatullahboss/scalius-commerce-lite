import { safeBatch, type Database } from "@scalius/database/client";
import { vendorPayoutMethods } from "@scalius/database/schema";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { encryptCredentials } from "../../utils/credential-encryption";

export type VendorPayoutMethod = "bank" | "bkash" | "nagad" | "rocket" | "manual";
export type VendorPayoutMethodStatus = "pending" | "verified" | "rejected" | "disabled";

export type VendorPayoutDestination =
    | {
        accountName: string;
        accountNumber: string;
        bankName: string;
        branchName: string | null;
        routingNumber: string | null;
    }
    | {
        accountName: string;
        phoneNumber: string;
    }
    | {
        instructions: string;
        reference: string | null;
    };

export interface MaskedVendorPayoutMethod {
    id: string;
    vendorId: string;
    method: VendorPayoutMethod;
    displayName: string;
    lastFour: string | null;
    providerName: string | null;
    isDefault: boolean;
    status: VendorPayoutMethodStatus;
    verifiedBy: string | null;
    verifiedAt: Date | null;
    rejectionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface VendorPayoutMethodDependencies {
    now: () => Date;
    id: () => string;
    encrypt: (plaintext: string, encryptionKey: string) => Promise<string>;
    fingerprint: (value: string) => Promise<string>;
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
}

const defaultDependencies: VendorPayoutMethodDependencies = {
    now: () => new Date(),
    id: () => `vendor_payout_method:${crypto.randomUUID()}`,
    encrypt: encryptCredentials,
    fingerprint: sha256Hex,
};

function requiredText(
    value: unknown,
    label: string,
    maxLength: number,
): string {
    if (typeof value !== "string") throw new ValidationError(`${label} is required`);
    const normalized = value.trim();
    if (!normalized) throw new ValidationError(`${label} is required`);
    if (normalized.length > maxLength) {
        throw new ValidationError(`${label} must not exceed ${maxLength} characters`);
    }
    return normalized;
}

function optionalText(value: unknown, maxLength: number): string | null {
    if (value == null || value === "") return null;
    if (typeof value !== "string") throw new ValidationError("Payout destination field must be text");
    const normalized = value.trim();
    if (!normalized) return null;
    if (normalized.length > maxLength) {
        throw new ValidationError(`Payout destination field must not exceed ${maxLength} characters`);
    }
    return normalized;
}

function compactDigits(value: unknown, label: string, minimum: number, maximum: number): string {
    const compact = requiredText(value, label, 100).replace(/[^0-9]/g, "");
    if (compact.length < minimum || compact.length > maximum) {
        throw new ValidationError(`${label} must contain ${minimum}-${maximum} digits`);
    }
    return compact;
}

export function normalizeVendorPayoutDestination(
    method: VendorPayoutMethod,
    destination: Record<string, unknown>,
): VendorPayoutDestination {
    if (!destination || typeof destination !== "object" || Array.isArray(destination)) {
        throw new ValidationError("Payout destination must be an object");
    }
    if (method === "bank") {
        return {
            accountName: requiredText(destination.accountName, "Account name", 160),
            accountNumber: compactDigits(destination.accountNumber, "Account number", 6, 34),
            bankName: requiredText(destination.bankName, "Bank name", 160),
            branchName: optionalText(destination.branchName, 160),
            routingNumber: destination.routingNumber == null || destination.routingNumber === ""
                ? null
                : compactDigits(destination.routingNumber, "Routing number", 4, 20),
        };
    }
    if (method === "bkash" || method === "nagad" || method === "rocket") {
        return {
            accountName: requiredText(destination.accountName, "Account name", 160),
            phoneNumber: compactDigits(destination.phoneNumber, "Phone number", 10, 15),
        };
    }
    if (method === "manual") {
        return {
            instructions: requiredText(destination.instructions, "Manual payout instructions", 2000),
            reference: optionalText(destination.reference, 200),
        };
    }
    throw new ValidationError("Unsupported payout method");
}

function destinationFingerprintSource(
    method: VendorPayoutMethod,
    destination: VendorPayoutDestination,
): string {
    if (method === "bank" && "accountNumber" in destination) {
        return `${method}:${destination.accountNumber}:${destination.bankName.toLowerCase()}`;
    }
    if ((method === "bkash" || method === "nagad" || method === "rocket") && "phoneNumber" in destination) {
        return `${method}:${destination.phoneNumber}`;
    }
    return `${method}:${JSON.stringify(destination)}`;
}

function destinationLastFour(destination: VendorPayoutDestination): string | null {
    if ("accountNumber" in destination) return destination.accountNumber.slice(-4);
    if ("phoneNumber" in destination) return destination.phoneNumber.slice(-4);
    if (destination.reference) return destination.reference.slice(-4);
    return null;
}

function maskedProjection() {
    return {
        id: vendorPayoutMethods.id,
        vendorId: vendorPayoutMethods.vendorId,
        method: vendorPayoutMethods.method,
        displayName: vendorPayoutMethods.displayName,
        lastFour: vendorPayoutMethods.lastFour,
        providerName: vendorPayoutMethods.providerName,
        isDefault: vendorPayoutMethods.isDefault,
        status: vendorPayoutMethods.status,
        verifiedBy: vendorPayoutMethods.verifiedBy,
        verifiedAt: vendorPayoutMethods.verifiedAt,
        rejectionReason: vendorPayoutMethods.rejectionReason,
        createdAt: vendorPayoutMethods.createdAt,
        updatedAt: vendorPayoutMethods.updatedAt,
    };
}

export async function listVendorPayoutMethods(
    db: Database,
    vendorId: string,
): Promise<MaskedVendorPayoutMethod[]> {
    return db.select(maskedProjection())
        .from(vendorPayoutMethods)
        .where(and(
            eq(vendorPayoutMethods.vendorId, vendorId),
            isNull(vendorPayoutMethods.deletedAt),
        ))
        .orderBy(desc(vendorPayoutMethods.isDefault), desc(vendorPayoutMethods.updatedAt))
        .all() as Promise<MaskedVendorPayoutMethod[]>;
}

export async function createVendorPayoutMethod(
    db: Database,
    input: {
        vendorId: string;
        method: VendorPayoutMethod;
        displayName: string;
        providerName?: string | null;
        isDefault?: boolean;
        destination: Record<string, unknown>;
        encryptionKey: string;
    },
    dependencies: VendorPayoutMethodDependencies = defaultDependencies,
): Promise<MaskedVendorPayoutMethod> {
    if (!input.encryptionKey?.trim()) {
        throw new ValidationError("Credential encryption is required to store payout destinations");
    }
    const displayName = requiredText(input.displayName, "Display name", 160);
    const providerName = optionalText(input.providerName, 160);
    const destination = normalizeVendorPayoutDestination(input.method, input.destination);
    const serialized = JSON.stringify(destination);
    const fingerprint = await dependencies.fingerprint(
        destinationFingerprintSource(input.method, destination),
    );
    const duplicate = await db.select({ id: vendorPayoutMethods.id })
        .from(vendorPayoutMethods)
        .where(and(
            eq(vendorPayoutMethods.vendorId, input.vendorId),
            eq(vendorPayoutMethods.fingerprint, fingerprint),
        ))
        .get();
    if (duplicate) throw new ConflictError("This payout destination is already registered");

    const now = dependencies.now();
    const id = dependencies.id();
    const isDefault = input.isDefault ?? false;
    const encryptedPayload = await dependencies.encrypt(serialized, input.encryptionKey);
    const values = {
        id,
        vendorId: input.vendorId,
        method: input.method,
        displayName,
        encryptedPayload,
        fingerprint,
        lastFour: destinationLastFour(destination),
        providerName,
        isDefault,
        status: "pending" as const,
        verifiedBy: null,
        verifiedAt: null,
        rejectionReason: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
    };
    const statements: unknown[] = [];
    if (isDefault) {
        statements.push(db.update(vendorPayoutMethods).set({
            isDefault: false,
            updatedAt: now,
        }).where(and(
            eq(vendorPayoutMethods.vendorId, input.vendorId),
            eq(vendorPayoutMethods.isDefault, true),
            isNull(vendorPayoutMethods.deletedAt),
        )).returning({ id: vendorPayoutMethods.id }));
    }
    statements.push(db.insert(vendorPayoutMethods).values(values));
    await safeBatch(db, statements as never[]);
    const { encryptedPayload: _encrypted, fingerprint: _fingerprint, deletedAt: _deleted, ...masked } = values;
    return masked;
}

async function readOwnedPayoutMethod(
    db: Database,
    vendorId: string,
    methodId: string,
) {
    const method = await db.select({
        id: vendorPayoutMethods.id,
        vendorId: vendorPayoutMethods.vendorId,
        status: vendorPayoutMethods.status,
        deletedAt: vendorPayoutMethods.deletedAt,
    })
        .from(vendorPayoutMethods)
        .where(and(
            eq(vendorPayoutMethods.id, methodId),
            eq(vendorPayoutMethods.vendorId, vendorId),
            isNull(vendorPayoutMethods.deletedAt),
        ))
        .get();
    if (!method) throw new NotFoundError("Seller payout method not found");
    return method;
}

export async function setDefaultVendorPayoutMethod(
    db: Database,
    vendorId: string,
    methodId: string,
    dependencies: Pick<VendorPayoutMethodDependencies, "now"> = defaultDependencies,
): Promise<{ id: string; isDefault: true }> {
    const method = await readOwnedPayoutMethod(db, vendorId, methodId);
    if (method.status !== "pending" && method.status !== "verified") {
        throw new ValidationError(`A ${method.status} payout method cannot be the default`);
    }
    const now = dependencies.now();
    const results = await safeBatch(db, [
        db.update(vendorPayoutMethods).set({ isDefault: false, updatedAt: now })
            .where(and(
                eq(vendorPayoutMethods.vendorId, vendorId),
                eq(vendorPayoutMethods.isDefault, true),
                ne(vendorPayoutMethods.id, methodId),
                isNull(vendorPayoutMethods.deletedAt),
            ))
            .returning({ id: vendorPayoutMethods.id }),
        db.update(vendorPayoutMethods).set({ isDefault: true, updatedAt: now })
            .where(and(
                eq(vendorPayoutMethods.id, methodId),
                eq(vendorPayoutMethods.vendorId, vendorId),
                isNull(vendorPayoutMethods.deletedAt),
            ))
            .returning({ id: vendorPayoutMethods.id }),
    ]) as unknown[];
    const updated = results[1] as Array<{ id: string }> | undefined;
    if ((updated?.length ?? 0) === 0) throw new ConflictError("Payout method changed concurrently");
    return { id: methodId, isDefault: true };
}

export async function disableVendorPayoutMethod(
    db: Database,
    vendorId: string,
    methodId: string,
    dependencies: Pick<VendorPayoutMethodDependencies, "now"> = defaultDependencies,
): Promise<{ id: string; status: "disabled" }> {
    const method = await readOwnedPayoutMethod(db, vendorId, methodId);
    if (method.status === "disabled") return { id: methodId, status: "disabled" };
    const rows = await safeBatch(db, [
        db.update(vendorPayoutMethods).set({
            status: "disabled",
            isDefault: false,
            updatedAt: dependencies.now(),
        }).where(and(
            eq(vendorPayoutMethods.id, methodId),
            eq(vendorPayoutMethods.vendorId, vendorId),
            ne(vendorPayoutMethods.status, "disabled"),
            isNull(vendorPayoutMethods.deletedAt),
        )).returning({ id: vendorPayoutMethods.id }),
    ]) as unknown[];
    const updated = rows[0] as Array<{ id: string }> | undefined;
    if ((updated?.length ?? 0) === 0) throw new ConflictError("Payout method changed concurrently");
    return { id: methodId, status: "disabled" };
}

export async function moderateVendorPayoutMethod(
    db: Database,
    input: {
        methodId: string;
        actorUserId: string;
        status: "verified" | "rejected";
        reason?: string | null;
    },
    dependencies: Pick<VendorPayoutMethodDependencies, "now"> = defaultDependencies,
): Promise<{ id: string; status: "verified" | "rejected" }> {
    const method = await db.select({
        id: vendorPayoutMethods.id,
        status: vendorPayoutMethods.status,
        deletedAt: vendorPayoutMethods.deletedAt,
    })
        .from(vendorPayoutMethods)
        .where(and(
            eq(vendorPayoutMethods.id, input.methodId),
            isNull(vendorPayoutMethods.deletedAt),
        ))
        .get();
    if (!method) throw new NotFoundError("Payout method not found");
    if (method.status !== "pending") {
        throw new ValidationError(`Only a pending payout method can be ${input.status}`);
    }
    const reason = input.reason?.trim() || null;
    if (input.status === "rejected" && !reason) {
        throw new ValidationError("A rejection reason is required");
    }
    const now = dependencies.now();
    const rows = await safeBatch(db, [
        db.update(vendorPayoutMethods).set({
            status: input.status,
            verifiedBy: input.actorUserId,
            verifiedAt: input.status === "verified" ? now : null,
            rejectionReason: input.status === "rejected" ? reason : null,
            updatedAt: now,
        }).where(and(
            eq(vendorPayoutMethods.id, input.methodId),
            eq(vendorPayoutMethods.status, "pending"),
            isNull(vendorPayoutMethods.deletedAt),
        )).returning({
            id: vendorPayoutMethods.id,
            status: vendorPayoutMethods.status,
        }),
    ]) as unknown[];
    const updated = rows[0] as Array<{ id: string; status: "verified" | "rejected" }> | undefined;
    if ((updated?.length ?? 0) === 0) throw new ConflictError("Payout method changed concurrently");
    return { id: input.methodId, status: input.status };
}
