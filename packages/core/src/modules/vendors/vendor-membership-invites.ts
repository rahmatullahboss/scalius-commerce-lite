import { safeBatch, type Database } from "@scalius/database/client";
import {
    user,
    vendorMembershipInvites,
    vendorUsers,
    vendors,
} from "@scalius/database/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import {
    hasVendorCapability,
    type VendorMembershipContext,
    type VendorMembershipRole,
    type VendorMembershipStatus,
} from "../../auth/vendor-context";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";

export type InvitableVendorRole = Exclude<VendorMembershipRole, "owner">;
export type ManageableVendorMemberStatus = Extract<VendorMembershipStatus, "active" | "suspended" | "revoked">;

export interface VendorMembershipInviteDependencies {
    now: () => Date;
    id: () => string;
    token: () => string;
    hashToken: (value: string) => Promise<string>;
}

function randomToken(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const defaultDependencies: VendorMembershipInviteDependencies = {
    now: () => new Date(),
    id: () => crypto.randomUUID(),
    token: randomToken,
    hashToken: sha256Hex,
};

const INVITABLE_ROLES = new Set<InvitableVendorRole>([
    "admin",
    "catalog",
    "fulfillment",
    "finance",
    "viewer",
]);

function assertCanManageMembers(context: VendorMembershipContext): void {
    if (!hasVendorCapability(context, "members.manage")) {
        throw new ValidationError("Active approved seller member-management access is required");
    }
}

function normalizeEmail(value: string): string {
    const email = value.trim().toLowerCase();
    if (email.length === 0 || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        throw new ValidationError("A valid invitee email is required");
    }
    return email;
}

function assertInvitableRole(role: string): asserts role is InvitableVendorRole {
    if (!INVITABLE_ROLES.has(role as InvitableVendorRole)) {
        throw new ValidationError("Seller invitations cannot grant owner access");
    }
}

function isInviteConstraint(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("vendor_membership_invites_pending_email_uq") ||
        message.includes("vendor_membership_invites_token_hash_uq") ||
        message.includes("UNIQUE constraint failed: vendor_membership_invites.vendor_id, vendor_membership_invites.invitee_email") ||
        message.includes("UNIQUE constraint failed: vendor_membership_invites.token_hash");
}

function isMembershipConstraint(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes("vendor_users_vendor_user_unique") ||
        message.includes("UNIQUE constraint failed: vendor_users.vendor_id, vendor_users.user_id");
}

export interface CreateVendorMembershipInviteInput {
    inviteeEmail: string;
    role: InvitableVendorRole;
    expiresInHours?: number;
}

export interface CreateVendorMembershipInviteResult {
    inviteId: string;
    vendorId: string;
    inviteeEmail: string;
    role: InvitableVendorRole;
    expiresAt: Date;
    token: string;
}

export async function createVendorMembershipInvite(
    db: Database,
    context: VendorMembershipContext,
    rawInput: CreateVendorMembershipInviteInput,
    dependencies: VendorMembershipInviteDependencies = defaultDependencies,
): Promise<CreateVendorMembershipInviteResult> {
    assertCanManageMembers(context);
    const inviteeEmail = normalizeEmail(rawInput.inviteeEmail);
    assertInvitableRole(rawInput.role);
    const expiresInHours = rawInput.expiresInHours ?? 168;
    if (!Number.isInteger(expiresInHours) || expiresInHours < 1 || expiresInHours > 720) {
        throw new ValidationError("Invitation expiry must be between 1 and 720 hours");
    }

    const matchingUsers = await db
        .select({ id: user.id })
        .from(user)
        .where(sql`lower(${user.email}) = ${inviteeEmail}`)
        .limit(1);
    const inviteeUser = matchingUsers[0] ?? null;
    if (inviteeUser) {
        const memberships = await db
            .select({ id: vendorUsers.id, status: vendorUsers.status })
            .from(vendorUsers)
            .where(and(
                eq(vendorUsers.vendorId, context.vendorId),
                eq(vendorUsers.userId, inviteeUser.id),
            ))
            .limit(1);
        const membership = memberships[0];
        if (membership && membership.status !== "revoked") {
            throw new ConflictError("This account is already a seller member");
        }
    }

    const pendingInvites = await db
        .select({ id: vendorMembershipInvites.id })
        .from(vendorMembershipInvites)
        .where(and(
            eq(vendorMembershipInvites.vendorId, context.vendorId),
            eq(vendorMembershipInvites.inviteeEmail, inviteeEmail),
            eq(vendorMembershipInvites.status, "pending"),
        ))
        .limit(1);
    if (pendingInvites.length > 0) {
        throw new ConflictError("A pending invitation already exists for this email");
    }

    const now = dependencies.now();
    const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000);
    const token = dependencies.token();
    if (!token || token.length > 1024) throw new ValidationError("Invitation credential generation failed");
    const tokenHash = await dependencies.hashToken(token);
    const inviteId = dependencies.id();

    try {
        await safeBatch(db, [db.insert(vendorMembershipInvites).values({
            id: inviteId,
            vendorId: context.vendorId,
            inviteeEmail,
            role: rawInput.role,
            tokenHash,
            status: "pending",
            invitedBy: context.userId,
            expiresAt,
            createdAt: now,
            updatedAt: now,
        })] as never[]);
    } catch (error: unknown) {
        if (isInviteConstraint(error)) {
            throw new ConflictError("The invitation conflicts with an existing pending invitation");
        }
        throw error;
    }

    return {
        inviteId,
        vendorId: context.vendorId,
        inviteeEmail,
        role: rawInput.role,
        expiresAt,
        token,
    };
}

export interface AcceptVendorMembershipInviteInput {
    token: string;
    userId: string;
}

export interface AcceptVendorMembershipInviteResult {
    inviteId: string;
    vendorId: string;
    membershipId: string;
    role: InvitableVendorRole;
}

export async function acceptVendorMembershipInvite(
    db: Database,
    input: AcceptVendorMembershipInviteInput,
    dependencies: VendorMembershipInviteDependencies = defaultDependencies,
): Promise<AcceptVendorMembershipInviteResult> {
    const token = input.token.trim();
    const userId = input.userId.trim();
    if (!token || !userId) throw new ValidationError("Invitation credential and authenticated user are required");
    const tokenHash = await dependencies.hashToken(token);

    const inviteRows = await db
        .select({
            id: vendorMembershipInvites.id,
            vendorId: vendorMembershipInvites.vendorId,
            inviteeEmail: vendorMembershipInvites.inviteeEmail,
            role: vendorMembershipInvites.role,
            status: vendorMembershipInvites.status,
            expiresAt: vendorMembershipInvites.expiresAt,
            invitedBy: vendorMembershipInvites.invitedBy,
            vendorStatus: vendors.status,
        })
        .from(vendorMembershipInvites)
        .innerJoin(vendors, eq(vendorMembershipInvites.vendorId, vendors.id))
        .where(eq(vendorMembershipInvites.tokenHash, tokenHash))
        .limit(1);
    const invite = inviteRows[0];
    if (!invite) throw new NotFoundError("Seller invitation not found");
    if (invite.status !== "pending") throw new ConflictError("Seller invitation is no longer pending");
    if (invite.expiresAt.getTime() <= dependencies.now().getTime()) {
        throw new ValidationError("Seller invitation has expired");
    }
    if (invite.vendorStatus !== "approved") {
        throw new ValidationError("Seller invitation cannot be accepted while the store is not approved");
    }

    const users = await db
        .select({ id: user.id, email: user.email })
        .from(user)
        .where(eq(user.id, userId))
        .limit(1);
    const acceptingUser = users[0];
    if (!acceptingUser) throw new ValidationError("Authenticated user account not found");
    if (normalizeEmail(acceptingUser.email) !== invite.inviteeEmail) {
        throw new ValidationError("Seller invitation email does not match the authenticated account");
    }

    const memberships = await db
        .select({
            id: vendorUsers.id,
            role: vendorUsers.role,
            status: vendorUsers.status,
        })
        .from(vendorUsers)
        .where(and(
            eq(vendorUsers.vendorId, invite.vendorId),
            eq(vendorUsers.userId, userId),
        ))
        .limit(1);
    const existingMembership = memberships[0] ?? null;
    if (existingMembership?.role === "owner") {
        throw new ValidationError("Owner membership cannot be changed through an invitation");
    }
    if (existingMembership?.status === "active") {
        throw new ConflictError("This account is already an active seller member");
    }

    const now = dependencies.now();
    const membershipId = existingMembership?.id ?? dependencies.id();
    const membershipWrite = existingMembership
        ? db.update(vendorUsers).set({
            role: invite.role,
            status: "active",
            invitedBy: invite.invitedBy,
            acceptedAt: now,
            revokedAt: null,
            updatedAt: now,
        }).where(and(
            eq(vendorUsers.id, existingMembership.id),
            eq(vendorUsers.vendorId, invite.vendorId),
            eq(vendorUsers.userId, userId),
        ))
        : db.insert(vendorUsers).values({
            id: membershipId,
            vendorId: invite.vendorId,
            userId,
            role: invite.role,
            status: "active",
            invitedBy: invite.invitedBy,
            invitedAt: now,
            acceptedAt: now,
            createdAt: now,
            updatedAt: now,
        });

    try {
        await safeBatch(db, [
            db.update(vendorMembershipInvites).set({
                status: "accepted",
                acceptedByUserId: userId,
                acceptedAt: now,
                updatedAt: now,
            }).where(and(
                eq(vendorMembershipInvites.id, invite.id),
                eq(vendorMembershipInvites.tokenHash, tokenHash),
                eq(vendorMembershipInvites.status, "pending"),
            )),
            membershipWrite,
        ] as never[]);
    } catch (error: unknown) {
        if (isMembershipConstraint(error) || isInviteConstraint(error)) {
            throw new ConflictError("Seller invitation was already consumed or membership changed concurrently");
        }
        throw error;
    }

    return {
        inviteId: invite.id,
        vendorId: invite.vendorId,
        membershipId,
        role: invite.role,
    };
}

export async function revokeVendorMembershipInvite(
    db: Database,
    context: VendorMembershipContext,
    inviteId: string,
    dependencies: VendorMembershipInviteDependencies = defaultDependencies,
): Promise<{ inviteId: string; status: "revoked" }> {
    assertCanManageMembers(context);
    const rows = await db
        .select({ id: vendorMembershipInvites.id, status: vendorMembershipInvites.status })
        .from(vendorMembershipInvites)
        .where(and(
            eq(vendorMembershipInvites.id, inviteId),
            eq(vendorMembershipInvites.vendorId, context.vendorId),
        ))
        .limit(1);
    const invite = rows[0];
    if (!invite) throw new NotFoundError("Seller invitation not found");
    if (invite.status !== "pending") throw new ConflictError("Only pending seller invitations can be revoked");
    const now = dependencies.now();
    await safeBatch(db, [db.update(vendorMembershipInvites).set({
        status: "revoked",
        revokedAt: now,
        updatedAt: now,
    }).where(and(
        eq(vendorMembershipInvites.id, invite.id),
        eq(vendorMembershipInvites.vendorId, context.vendorId),
        eq(vendorMembershipInvites.status, "pending"),
    ))] as never[]);
    return { inviteId: invite.id, status: "revoked" };
}

export interface UpdateVendorMemberInput {
    membershipId: string;
    role?: InvitableVendorRole;
    status?: ManageableVendorMemberStatus;
}

export async function updateVendorMember(
    db: Database,
    context: VendorMembershipContext,
    input: UpdateVendorMemberInput,
    dependencies: VendorMembershipInviteDependencies = defaultDependencies,
): Promise<{ membershipId: string; role: InvitableVendorRole; status: ManageableVendorMemberStatus }> {
    assertCanManageMembers(context);
    if (input.role !== undefined) assertInvitableRole(input.role);
    if (input.status !== undefined && !["active", "suspended", "revoked"].includes(input.status)) {
        throw new ValidationError("Unsupported seller membership status");
    }

    const rows = await db
        .select({
            id: vendorUsers.id,
            userId: vendorUsers.userId,
            role: vendorUsers.role,
            status: vendorUsers.status,
        })
        .from(vendorUsers)
        .where(and(
            eq(vendorUsers.id, input.membershipId),
            eq(vendorUsers.vendorId, context.vendorId),
        ))
        .limit(1);
    const member = rows[0];
    if (!member) throw new NotFoundError("Seller member not found");
    if (member.role === "owner") throw new ValidationError("Owner membership requires the dedicated ownership workflow");
    if (member.userId === context.userId) throw new ValidationError("Seller members cannot change their own access");
    if (member.status === "invited") throw new ValidationError("Invited membership must be accepted through its invitation");
    if (member.status === "revoked") throw new ValidationError("Revoked membership requires a new invitation");

    const nextRole = input.role ?? member.role;
    assertInvitableRole(nextRole);
    const nextStatus = input.status ?? member.status;
    const now = dependencies.now();
    await safeBatch(db, [db.update(vendorUsers).set({
        role: nextRole,
        status: nextStatus,
        revokedAt: nextStatus === "revoked" ? now : null,
        updatedAt: now,
    }).where(and(
        eq(vendorUsers.id, member.id),
        eq(vendorUsers.vendorId, context.vendorId),
        eq(vendorUsers.role, member.role),
        eq(vendorUsers.status, member.status),
    ))] as never[]);

    return {
        membershipId: member.id,
        role: nextRole,
        status: nextStatus,
    };
}

export interface VendorTeamMemberRow {
    membershipId: string;
    userId: string;
    name: string;
    email: string;
    role: VendorMembershipRole;
    status: VendorMembershipStatus;
    acceptedAt: Date | null;
    updatedAt: Date;
}

export interface VendorTeamInviteRow {
    inviteId: string;
    inviteeEmail: string;
    role: InvitableVendorRole;
    status: "pending" | "accepted" | "revoked" | "expired";
    invitedBy: string;
    expiresAt: Date;
    acceptedByUserId: string | null;
    acceptedAt: Date | null;
    revokedAt: Date | null;
    createdAt: Date;
}

export async function listVendorTeam(
    db: Database,
    context: VendorMembershipContext,
): Promise<{ members: VendorTeamMemberRow[]; invites: VendorTeamInviteRow[] }> {
    assertCanManageMembers(context);
    const members = await db
        .select({
            membershipId: vendorUsers.id,
            userId: vendorUsers.userId,
            name: user.name,
            email: user.email,
            role: vendorUsers.role,
            status: vendorUsers.status,
            acceptedAt: vendorUsers.acceptedAt,
            updatedAt: vendorUsers.updatedAt,
        })
        .from(vendorUsers)
        .innerJoin(user, eq(vendorUsers.userId, user.id))
        .where(eq(vendorUsers.vendorId, context.vendorId))
        .orderBy(user.email)
        .all();
    const invites = await db
        .select({
            inviteId: vendorMembershipInvites.id,
            inviteeEmail: vendorMembershipInvites.inviteeEmail,
            role: vendorMembershipInvites.role,
            status: vendorMembershipInvites.status,
            invitedBy: vendorMembershipInvites.invitedBy,
            expiresAt: vendorMembershipInvites.expiresAt,
            acceptedByUserId: vendorMembershipInvites.acceptedByUserId,
            acceptedAt: vendorMembershipInvites.acceptedAt,
            revokedAt: vendorMembershipInvites.revokedAt,
            createdAt: vendorMembershipInvites.createdAt,
        })
        .from(vendorMembershipInvites)
        .where(eq(vendorMembershipInvites.vendorId, context.vendorId))
        .orderBy(desc(vendorMembershipInvites.createdAt))
        .limit(100)
        .all();
    return { members, invites };
}
