import type { Database } from "@scalius/database/client";
import {
    PLATFORM_VENDOR_ID,
    products,
    vendorCommissionRules,
    vendorOrders,
    vendors,
} from "@scalius/database/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
    basisPoints,
    calculateBasisPoints,
    minorUnits,
    moneyToMinor,
    multiplyMinorUnits,
} from "../marketplace/money";

const PLATFORM_VENDOR_NAME = "Platform";
const PLATFORM_COMMISSION_RULE_ID = "commission_platform_default";
const DEFAULT_CURRENCY = "BDT";

export interface VendorOrderSplitItemInput {
    id: string;
    productId: string;
    quantity: number;
    price: number;
    fulfillmentStatus?: string;
    discountMinor?: number;
}

export interface ProductVendorAllocationContext {
    productId: string;
    vendorId: string;
    vendorName: string;
    commissionRuleId: string;
    commissionBps: number;
}

export interface CanonicalOrderItemAllocation {
    vendorOrderId: string;
    vendorIdSnapshot: string;
    vendorNameSnapshot: string;
    currency: string;
    unitPriceMinor: number;
    lineSubtotalMinor: number;
    discountMinor: number;
    commissionRuleId: string;
    commissionBps: number;
    commissionMinor: number;
    vendorNetMinor: number;
}

export interface CanonicalVendorOrderInsert {
    id: string;
    orderId: string;
    vendorId: string;
    status: "pending";
    fulfillmentStatus: "pending";
    version: 1;
}

export interface VendorOrderAllocationPlan {
    vendorOrders: CanonicalVendorOrderInsert[];
    itemAllocations: Map<string, CanonicalOrderItemAllocation>;
}

export interface VendorOrderSplitWritePlan extends VendorOrderAllocationPlan {
    vendorOrderWrites: unknown[];
}

function buildVendorOrderId(orderId: string, vendorId: string): string {
    return `vendor_order_${orderId}_${vendorId}`;
}

function platformContext(productId: string): ProductVendorAllocationContext {
    return {
        productId,
        vendorId: PLATFORM_VENDOR_ID,
        vendorName: PLATFORM_VENDOR_NAME,
        commissionRuleId: PLATFORM_COMMISSION_RULE_ID,
        commissionBps: 0,
    };
}

export function allocateVendorOrderSplit({
    orderId,
    items,
    productContexts,
    currency = DEFAULT_CURRENCY,
}: {
    orderId: string;
    items: VendorOrderSplitItemInput[];
    productContexts: ReadonlyMap<string, ProductVendorAllocationContext>;
    currency?: string;
}): VendorOrderAllocationPlan {
    if (!orderId.trim()) throw new Error("Order id is required for vendor allocation.");
    if (!currency.trim()) throw new Error("Currency is required for vendor allocation.");

    const vendorOrderByVendor = new Map<string, CanonicalVendorOrderInsert>();
    const itemAllocations = new Map<string, CanonicalOrderItemAllocation>();

    for (const item of items) {
        if (!item.id.trim()) throw new Error("Order item id is required for vendor allocation.");
        if (!item.productId.trim()) throw new Error("Product id is required for vendor allocation.");
        if (itemAllocations.has(item.id)) throw new Error(`Duplicate order item id: ${item.id}`);

        const context = productContexts.get(item.productId) ?? platformContext(item.productId);
        const unitPriceMinor = moneyToMinor(item.price, "Item price");
        const lineSubtotalMinor = multiplyMinorUnits(unitPriceMinor, item.quantity);
        const discountMinor = minorUnits(item.discountMinor ?? 0);
        if (discountMinor > lineSubtotalMinor) {
            throw new Error("Item discount cannot exceed line subtotal.");
        }

        const commissionBaseMinor = minorUnits(lineSubtotalMinor - discountMinor);
        const commissionMinor = calculateBasisPoints(
            commissionBaseMinor,
            basisPoints(context.commissionBps),
        );
        const vendorNetMinor = commissionBaseMinor - commissionMinor;
        const vendorOrderId = buildVendorOrderId(orderId, context.vendorId);

        if (!vendorOrderByVendor.has(context.vendorId)) {
            vendorOrderByVendor.set(context.vendorId, {
                id: vendorOrderId,
                orderId,
                vendorId: context.vendorId,
                status: "pending",
                fulfillmentStatus: "pending",
                version: 1,
            });
        }

        itemAllocations.set(item.id, {
            vendorOrderId,
            vendorIdSnapshot: context.vendorId,
            vendorNameSnapshot: context.vendorName,
            currency,
            unitPriceMinor,
            lineSubtotalMinor,
            discountMinor,
            commissionRuleId: context.commissionRuleId,
            commissionBps: context.commissionBps,
            commissionMinor,
            vendorNetMinor,
        });
    }

    return {
        vendorOrders: Array.from(vendorOrderByVendor.values()),
        itemAllocations,
    };
}

function timestampValue(value: Date | number | null): number | null {
    if (value === null) return null;
    if (value instanceof Date) return value.getTime();
    return Number(value) * 1_000;
}

interface RowReader<T> {
    all?: () => Promise<T[]>;
    get?: () => Promise<T | undefined>;
}

async function readRows<T>(query: RowReader<T>): Promise<T[]> {
    if (typeof query.all === "function") return query.all();
    if (typeof query.get === "function") {
        const row = await query.get();
        return row ? [row] : [];
    }
    throw new Error("Database query adapter does not support all() or get().");
}

interface ProductOwnerRow {
    productId: string;
    vendorId: string | null;
}

interface VendorNameRow {
    id: string;
    name: string;
}

interface CommissionRuleRow {
    id: string;
    vendorId: string | null;
    rateBps: number;
    priority: number;
    effectiveFrom: Date | number;
    effectiveTo: Date | number | null;
}

async function loadProductVendorContexts(
    db: Database,
    productIds: string[],
): Promise<Map<string, ProductVendorAllocationContext>> {
    if (productIds.length === 0) return new Map();

    const productRows = await readRows<ProductOwnerRow>(db
        .select({
            productId: products.id,
            vendorId: products.vendorId,
        })
        .from(products)
        .where(inArray(products.id, productIds)) as unknown as RowReader<ProductOwnerRow>);

    if (productRows.length === 0) return new Map();

    const vendorIds = Array.from(new Set(
        productRows
            .map((row) => row.vendorId ?? PLATFORM_VENDOR_ID)
            .filter((vendorId) => vendorId !== PLATFORM_VENDOR_ID),
    ));

    const vendorRows = vendorIds.length > 0
        ? await readRows<VendorNameRow>(db
            .select({ id: vendors.id, name: vendors.name })
            .from(vendors)
            .where(inArray(vendors.id, vendorIds)) as unknown as RowReader<VendorNameRow>)
        : [];
    const vendorNameById = new Map(vendorRows.map((row) => [row.id, row.name]));

    const scopePredicate = vendorIds.length > 0
        ? or(isNull(vendorCommissionRules.vendorId), inArray(vendorCommissionRules.vendorId, vendorIds))
        : isNull(vendorCommissionRules.vendorId);

    const ruleRows = await readRows<CommissionRuleRow>(db
        .select({
            id: vendorCommissionRules.id,
            vendorId: vendorCommissionRules.vendorId,
            rateBps: vendorCommissionRules.rateBps,
            priority: vendorCommissionRules.priority,
            effectiveFrom: vendorCommissionRules.effectiveFrom,
            effectiveTo: vendorCommissionRules.effectiveTo,
        })
        .from(vendorCommissionRules)
        .where(and(eq(vendorCommissionRules.status, "active"), scopePredicate)) as unknown as RowReader<CommissionRuleRow>);

    const now = Date.now();
    const eligibleRules = ruleRows
        .filter((rule) => {
            const from = timestampValue(rule.effectiveFrom) ?? 0;
            const to = timestampValue(rule.effectiveTo);
            return from <= now && (to === null || to > now);
        })
        .sort((a, b) => {
            if (a.priority !== b.priority) return b.priority - a.priority;
            return (timestampValue(b.effectiveFrom) ?? 0) - (timestampValue(a.effectiveFrom) ?? 0);
        });

    const platformRule = eligibleRules.find((rule) => rule.vendorId === null);
    const vendorRuleById = new Map<string, CommissionRuleRow>();
    for (const rule of eligibleRules) {
        if (rule.vendorId && !vendorRuleById.has(rule.vendorId)) {
            vendorRuleById.set(rule.vendorId, rule);
        }
    }

    return new Map(productRows.map((row) => {
        const vendorId = row.vendorId ?? PLATFORM_VENDOR_ID;
        const rule = vendorRuleById.get(vendorId) ?? platformRule;
        return [row.productId, {
            productId: row.productId,
            vendorId,
            vendorName: vendorId === PLATFORM_VENDOR_ID
                ? PLATFORM_VENDOR_NAME
                : vendorNameById.get(vendorId) ?? "Seller",
            commissionRuleId: rule?.id ?? PLATFORM_COMMISSION_RULE_ID,
            commissionBps: rule?.rateBps ?? 0,
        } satisfies ProductVendorAllocationContext];
    }));
}

export async function buildVendorOrderSplitPlan(
    db: Database,
    orderId: string,
    items: VendorOrderSplitItemInput[],
): Promise<VendorOrderSplitWritePlan> {
    if (items.length === 0) {
        return { vendorOrders: [], itemAllocations: new Map(), vendorOrderWrites: [] };
    }

    const productIds = Array.from(new Set(items.map((item) => item.productId)));
    const productContexts = await loadProductVendorContexts(db, productIds);
    const allocation = allocateVendorOrderSplit({ orderId, items, productContexts });
    const vendorOrderWrites = allocation.vendorOrders.map((vendorOrder) => {
        const statement = db.insert(vendorOrders).values({
            ...vendorOrder,
            createdAt: sql`unixepoch()`,
            updatedAt: sql`unixepoch()`,
        });
        const conflictCapable = statement as typeof statement & {
            onConflictDoNothing?: (config: { target: unknown[] }) => unknown;
        };
        return typeof conflictCapable.onConflictDoNothing === "function"
            ? conflictCapable.onConflictDoNothing({ target: [vendorOrders.orderId, vendorOrders.vendorId] })
            : statement;
    });

    return { ...allocation, vendorOrderWrites };
}
