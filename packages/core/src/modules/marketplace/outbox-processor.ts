import type { Database } from "@scalius/database/client";
import { domainOutboxEvents } from "@scalius/database/schema";
import {
    and,
    asc,
    eq,
    inArray,
    isNull,
    lt,
    lte,
    or,
} from "drizzle-orm";
import { postMarketplaceFinancialEvent } from "./financial-events";

export interface MarketplaceOutboxBatchResult {
    enabled: boolean;
    scanned: number;
    claimed: number;
    processed: number;
    failed: number;
    dead: number;
    skipped: number;
}

export interface MarketplaceOutboxProcessorOptions {
    enabled: boolean;
    limit?: number;
    maxAttempts?: number;
    claimTtlSeconds?: number;
    now?: Date;
    claimId?: () => string;
    handler?: typeof postMarketplaceFinancialEvent;
}

function errorMessage(error: unknown): string {
    const value = error instanceof Error ? error.message : String(error);
    return value.slice(0, 2_000);
}

function retryDate(now: Date, attempts: number): Date {
    const delaySeconds = Math.min(3_600, 30 * 2 ** Math.max(0, attempts - 1));
    return new Date(now.getTime() + delaySeconds * 1000);
}

export async function processMarketplaceOutboxBatch(
    db: Database,
    options: MarketplaceOutboxProcessorOptions,
): Promise<MarketplaceOutboxBatchResult> {
    const result: MarketplaceOutboxBatchResult = {
        enabled: options.enabled,
        scanned: 0,
        claimed: 0,
        processed: 0,
        failed: 0,
        dead: 0,
        skipped: 0,
    };
    if (!options.enabled) return result;

    const limit = options.limit ?? 20;
    const maxAttempts = options.maxAttempts ?? 8;
    const claimTtlSeconds = options.claimTtlSeconds ?? 300;
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
        throw new Error("Marketplace outbox batch limit must be an integer between 1 and 100.");
    }
    if (!Number.isInteger(maxAttempts) || maxAttempts <= 0 || maxAttempts > 100) {
        throw new Error("Marketplace outbox max attempts must be an integer between 1 and 100.");
    }

    const now = options.now ?? new Date();
    const handler = options.handler ?? postMarketplaceFinancialEvent;
    const createClaimId = options.claimId ?? (() => crypto.randomUUID());

    const candidates = await db
        .select({
            id: domainOutboxEvents.id,
            eventType: domainOutboxEvents.eventType,
            aggregateId: domainOutboxEvents.aggregateId,
            attempts: domainOutboxEvents.attempts,
        })
        .from(domainOutboxEvents)
        .where(and(
            inArray(domainOutboxEvents.status, ["pending", "failed"]),
            or(
                isNull(domainOutboxEvents.nextAttemptAt),
                lte(domainOutboxEvents.nextAttemptAt, now),
            ),
            or(
                isNull(domainOutboxEvents.claimExpiresAt),
                lt(domainOutboxEvents.claimExpiresAt, now),
            ),
        ))
        .orderBy(asc(domainOutboxEvents.createdAt))
        .limit(limit)
        .all();

    result.scanned = candidates.length;
    for (const event of candidates) {
        const claimId = createClaimId();
        const attempts = event.attempts + 1;
        const claimExpiresAt = new Date(now.getTime() + claimTtlSeconds * 1000);
        const claimed = await db
            .update(domainOutboxEvents)
            .set({
                status: "processing",
                attempts,
                claimId,
                claimExpiresAt,
                lastError: null,
            })
            .where(and(
                eq(domainOutboxEvents.id, event.id),
                inArray(domainOutboxEvents.status, ["pending", "failed"]),
                or(
                    isNull(domainOutboxEvents.nextAttemptAt),
                    lte(domainOutboxEvents.nextAttemptAt, now),
                ),
                or(
                    isNull(domainOutboxEvents.claimExpiresAt),
                    lt(domainOutboxEvents.claimExpiresAt, now),
                ),
            ))
            .returning({ id: domainOutboxEvents.id })
            .get();

        if (!claimed) {
            result.skipped += 1;
            continue;
        }
        result.claimed += 1;

        try {
            await handler(db, {
                eventType: event.eventType,
                aggregateId: event.aggregateId,
            });
            await db
                .update(domainOutboxEvents)
                .set({
                    status: "processed",
                    claimId: null,
                    claimExpiresAt: null,
                    lastError: null,
                    nextAttemptAt: null,
                    failedAt: null,
                    processedAt: now,
                })
                .where(and(
                    eq(domainOutboxEvents.id, event.id),
                    eq(domainOutboxEvents.claimId, claimId),
                    eq(domainOutboxEvents.status, "processing"),
                ))
                .run();
            result.processed += 1;
        } catch (error: unknown) {
            const isDead = attempts >= maxAttempts;
            await db
                .update(domainOutboxEvents)
                .set({
                    status: isDead ? "dead" : "failed",
                    attempts,
                    claimId: null,
                    claimExpiresAt: null,
                    lastError: errorMessage(error),
                    nextAttemptAt: isDead ? null : retryDate(now, attempts),
                    failedAt: isDead ? now : null,
                })
                .where(and(
                    eq(domainOutboxEvents.id, event.id),
                    eq(domainOutboxEvents.claimId, claimId),
                    eq(domainOutboxEvents.status, "processing"),
                ))
                .run();
            if (isDead) result.dead += 1;
            else result.failed += 1;
        }
    }

    return result;
}
