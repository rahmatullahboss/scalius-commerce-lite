import type { Database } from "@scalius/database/client";
import { vendorOrders } from "@scalius/database/schema";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { ConflictError, ValidationError } from "../../errors";
import {
    releaseVendorOrderSettlement,
    type ReleaseVendorOrderSettlementResult,
} from "./settlement";

export interface SettlementReleaseBatchResult {
    enabled: boolean;
    scanned: number;
    released: number;
    replayed: number;
    skipped: number;
    failed: number;
}

export interface SettlementReleaseBatchOptions {
    enabled: boolean;
    limit?: number;
    now?: Date;
    release?: (
        db: Database,
        input: { vendorOrderId: string; now: Date },
    ) => Promise<ReleaseVendorOrderSettlementResult>;
}

export async function processSettlementReleaseBatch(
    db: Database,
    options: SettlementReleaseBatchOptions,
): Promise<SettlementReleaseBatchResult> {
    const result: SettlementReleaseBatchResult = {
        enabled: options.enabled,
        scanned: 0,
        released: 0,
        replayed: 0,
        skipped: 0,
        failed: 0,
    };
    if (!options.enabled) return result;

    const limit = options.limit ?? 20;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
        throw new ValidationError("Settlement sweep limit must be between 1 and 100");
    }
    const now = options.now ?? new Date();
    const release = options.release ?? releaseVendorOrderSettlement;
    const candidates = await db
        .select({ vendorOrderId: vendorOrders.id })
        .from(vendorOrders)
        .where(and(
            eq(vendorOrders.status, "delivered"),
            isNotNull(vendorOrders.deliveredAt),
        ))
        .orderBy(asc(vendorOrders.deliveredAt))
        .limit(limit)
        .all();

    result.scanned = candidates.length;
    for (const candidate of candidates) {
        try {
            const releaseResult = await release(db, {
                vendorOrderId: candidate.vendorOrderId,
                now,
            });
            if (releaseResult.replayed) result.replayed += 1;
            else result.released += 1;
        } catch (error: unknown) {
            if (error instanceof ValidationError || error instanceof ConflictError) {
                result.skipped += 1;
            } else {
                result.failed += 1;
            }
        }
    }
    return result;
}
