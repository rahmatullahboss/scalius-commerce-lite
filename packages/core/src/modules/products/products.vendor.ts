import { safeBatch, type Database } from "@scalius/database/client";
import {
    productAttributeValues,
    productImages,
    productModerationEvents,
    productRichContent,
    products,
    productVariants,
} from "@scalius/database/schema";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { z } from "zod";
import { ConflictError, NotFoundError, ValidationError } from "../../errors";
import { checkAndAlertLowStock } from "../inventory/alerts";
import { buildStockMovementClaim } from "../inventory/stock-movement-claims";
import type { CreateProductInput, UpdateProductInput } from "./products.validation";
import { updateVariantSchema } from "./products.types";
import type { ProductModerationStatus } from "../vendors/vendor-state-machine";

export interface VendorProductCommandDependencies {
    now: () => Date;
    id: () => string;
}

const defaultDependencies: VendorProductCommandDependencies = {
    now: () => new Date(),
    id: () => crypto.randomUUID(),
};

interface VendorProductContext {
    id: string;
    vendorId: string;
    approvalStatus: ProductModerationStatus;
    moderationVersion: number;
    price: number;
}

function defaultVariantValues(
    productId: string,
    variantId: string,
    price: number,
    now: Date,
) {
    return {
        id: variantId,
        productId,
        size: null,
        color: null,
        weight: null,
        sku: `SIMPLE-${productId}`,
        price,
        stock: 0,
        reservedStock: 0,
        preorderStock: 0,
        isDefault: true,
        trackInventory: false,
        version: 1,
        stockVersion: 1,
        allowPreorder: false,
        allowBackorder: false,
        backorderLimit: 0,
        discountPercentage: 0,
        discountType: "percentage" as const,
        discountAmount: 0,
        colorSortOrder: 0,
        sizeSortOrder: 0,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
    };
}

function moderationEventValues(input: {
    id: string;
    productId: string;
    vendorId: string;
    fromStatus: ProductModerationStatus | null;
    toStatus: ProductModerationStatus;
    actorUserId: string;
    moderationVersion: number;
    reason: string;
    now: Date;
}) {
    return {
        id: input.id,
        productId: input.productId,
        vendorId: input.vendorId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason,
        actorUserId: input.actorUserId,
        moderationVersion: input.moderationVersion,
        metadata: { actorType: "vendor" },
        createdAt: input.now,
    };
}

function imageValues(
    productId: string,
    data: CreateProductInput | UpdateProductInput,
    dependencies: VendorProductCommandDependencies,
) {
    return data.images.map((image, index) => ({
        id: image.id.startsWith("temp_") ? dependencies.id() : image.id,
        productId,
        url: image.url,
        alt: image.filename,
        isPrimary: index === 0,
        sortOrder: index,
    }));
}

function attributeValues(
    productId: string,
    data: CreateProductInput | UpdateProductInput,
    dependencies: VendorProductCommandDependencies,
) {
    return (data.attributes ?? [])
        .filter((attribute) => attribute.attributeId && attribute.value.trim())
        .map((attribute) => ({
            id: dependencies.id(),
            productId,
            attributeId: attribute.attributeId,
            value: attribute.value.trim(),
        }));
}

function richContentValues(
    productId: string,
    data: CreateProductInput | UpdateProductInput,
    dependencies: VendorProductCommandDependencies,
) {
    return (data.additionalInfo ?? [])
        .filter((item) => item.title.trim() && item.content.trim())
        .map((item) => ({
            id: item.id.startsWith("item-") ? dependencies.id() : item.id,
            productId,
            title: item.title.trim(),
            content: item.content.trim(),
            sortOrder: item.sortOrder,
        }));
}

async function assertSlugAvailable(
    db: Database,
    slug: string,
    productId?: string,
): Promise<void> {
    const condition = productId
        ? and(eq(products.slug, slug), ne(products.id, productId), isNull(products.deletedAt))
        : and(eq(products.slug, slug), isNull(products.deletedAt));
    const duplicate = await db
        .select({ id: products.id })
        .from(products)
        .where(condition)
        .get();
    if (duplicate) throw new ConflictError("A product with this slug already exists");
}

async function readOwnedProduct(
    db: Database,
    vendorId: string,
    productId: string,
): Promise<VendorProductContext> {
    const product = await db
        .select({
            id: products.id,
            vendorId: products.vendorId,
            approvalStatus: products.approvalStatus,
            moderationVersion: products.moderationVersion,
            price: products.price,
        })
        .from(products)
        .where(and(
            eq(products.id, productId),
            eq(products.vendorId, vendorId),
            isNull(products.deletedAt),
        ))
        .get();
    if (!product || !product.vendorId) {
        throw new NotFoundError("Seller product not found");
    }
    return product as VendorProductContext;
}

export async function createVendorProduct(
    db: Database,
    input: {
        vendorId: string;
        actorUserId: string;
        data: CreateProductInput;
    },
    dependencies: VendorProductCommandDependencies = defaultDependencies,
): Promise<{ productId: string; approvalStatus: "draft" }> {
    await assertSlugAvailable(db, input.data.slug);
    const now = dependencies.now();
    const productId = dependencies.id();
    const images = imageValues(productId, input.data, dependencies);
    const attributes = attributeValues(productId, input.data, dependencies);
    const richContent = richContentValues(productId, input.data, dependencies);
    const statements: unknown[] = [
        db.insert(products).values({
            id: productId,
            vendorId: input.vendorId,
            name: input.data.name,
            description: input.data.description,
            price: input.data.price,
            categoryId: input.data.categoryId,
            slug: input.data.slug,
            metaTitle: input.data.metaTitle,
            metaDescription: input.data.metaDescription,
            approvalStatus: "draft",
            moderationVersion: 1,
            isActive: input.data.isActive,
            discountType: input.data.discountType ?? "percentage",
            discountPercentage: (input.data.discountType ?? "percentage") === "percentage"
                ? input.data.discountPercentage ?? null
                : 0,
            discountAmount: (input.data.discountType ?? "percentage") === "flat"
                ? input.data.discountAmount ?? null
                : 0,
            freeDelivery: input.data.freeDelivery,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
        }),
        db.insert(productVariants).values(
            defaultVariantValues(productId, dependencies.id(), input.data.price, now),
        ),
    ];
    if (images.length > 0) statements.push(db.insert(productImages).values(images));
    if (attributes.length > 0) statements.push(db.insert(productAttributeValues).values(attributes));
    if (richContent.length > 0) statements.push(db.insert(productRichContent).values(richContent));
    statements.push(db.insert(productModerationEvents).values(moderationEventValues({
        id: dependencies.id(),
        productId,
        vendorId: input.vendorId,
        fromStatus: null,
        toStatus: "draft",
        actorUserId: input.actorUserId,
        moderationVersion: 1,
        reason: "Seller created product draft",
        now,
    })));
    await safeBatch(db, statements as never[]);
    return { productId, approvalStatus: "draft" };
}

function revisionStatus(current: ProductModerationStatus): {
    nextStatus: "draft" | "submitted";
    bumpModerationVersion: boolean;
    reason: string | null;
} {
    switch (current) {
        case "draft":
            return { nextStatus: "draft", bumpModerationVersion: false, reason: null };
        case "rejected":
            return {
                nextStatus: "draft",
                bumpModerationVersion: true,
                reason: "Seller revised rejected product",
            };
        case "approved":
            return {
                nextStatus: "submitted",
                bumpModerationVersion: true,
                reason: "Seller submitted an approved product revision",
            };
        case "submitted":
            throw new ValidationError("Submitted products cannot be edited until moderation is complete");
        case "suspended":
            throw new ValidationError("Suspended products cannot be edited by the seller");
    }
}

export async function updateVendorProduct(
    db: Database,
    input: {
        vendorId: string;
        productId: string;
        actorUserId: string;
        data: UpdateProductInput;
    },
    dependencies: VendorProductCommandDependencies = defaultDependencies,
): Promise<{ approvalStatus: "draft" | "submitted"; moderationVersion: number }> {
    const current = await readOwnedProduct(db, input.vendorId, input.productId);
    const revision = revisionStatus(current.approvalStatus);
    await assertSlugAvailable(db, input.data.slug, input.productId);
    const activeVariants = await db
        .select({
            id: productVariants.id,
            isDefault: productVariants.isDefault,
            size: productVariants.size,
            color: productVariants.color,
        })
        .from(productVariants)
        .where(and(eq(productVariants.productId, input.productId), isNull(productVariants.deletedAt)))
        .all();
    const moderationVersion = revision.bumpModerationVersion
        ? current.moderationVersion + 1
        : current.moderationVersion;
    const now = dependencies.now();
    const images = imageValues(input.productId, input.data, dependencies);
    const attributes = attributeValues(input.productId, input.data, dependencies);
    const richContent = richContentValues(input.productId, input.data, dependencies);
    const statements: unknown[] = [
        db.update(products).set({
            name: input.data.name,
            description: input.data.description,
            price: input.data.price,
            categoryId: input.data.categoryId,
            slug: input.data.slug,
            metaTitle: input.data.metaTitle,
            metaDescription: input.data.metaDescription,
            approvalStatus: revision.nextStatus,
            moderationVersion,
            isActive: input.data.isActive,
            discountType: input.data.discountType ?? "percentage",
            discountPercentage: (input.data.discountType ?? "percentage") === "percentage"
                ? input.data.discountPercentage ?? null
                : 0,
            discountAmount: (input.data.discountType ?? "percentage") === "flat"
                ? input.data.discountAmount ?? null
                : 0,
            freeDelivery: input.data.freeDelivery,
            updatedAt: now,
        }).where(and(eq(products.id, input.productId), eq(products.vendorId, input.vendorId))),
        db.delete(productImages).where(eq(productImages.productId, input.productId)),
        db.delete(productAttributeValues).where(eq(productAttributeValues.productId, input.productId)),
        db.delete(productRichContent).where(eq(productRichContent.productId, input.productId)),
    ];
    if (images.length > 0) statements.push(db.insert(productImages).values(images));
    if (attributes.length > 0) statements.push(db.insert(productAttributeValues).values(attributes));
    if (richContent.length > 0) statements.push(db.insert(productRichContent).values(richContent));

    if (activeVariants.length === 0) {
        statements.push(db.insert(productVariants).values(
            defaultVariantValues(input.productId, dependencies.id(), input.data.price, now),
        ));
    } else {
        const simpleDefault = activeVariants.length === 1 &&
            activeVariants[0]?.isDefault === true &&
            !activeVariants[0]?.size &&
            !activeVariants[0]?.color;
        if (simpleDefault) {
            statements.push(db.update(productVariants).set({
                price: input.data.price,
                updatedAt: now,
            }).where(eq(productVariants.id, activeVariants[0]!.id)));
        }
    }

    if (revision.reason) {
        statements.push(db.insert(productModerationEvents).values(moderationEventValues({
            id: dependencies.id(),
            productId: input.productId,
            vendorId: input.vendorId,
            fromStatus: current.approvalStatus,
            toStatus: revision.nextStatus,
            actorUserId: input.actorUserId,
            moderationVersion,
            reason: revision.reason,
            now,
        })));
    }
    await safeBatch(db, statements as never[]);
    return { approvalStatus: revision.nextStatus, moderationVersion };
}

export async function submitVendorProduct(
    db: Database,
    input: {
        vendorId: string;
        productId: string;
        actorUserId: string;
    },
    dependencies: VendorProductCommandDependencies = defaultDependencies,
): Promise<{ approvalStatus: "submitted"; moderationVersion: number }> {
    const current = await readOwnedProduct(db, input.vendorId, input.productId);
    if (current.approvalStatus === "submitted") {
        return { approvalStatus: "submitted", moderationVersion: current.moderationVersion };
    }
    if (!(["draft", "rejected"] as ProductModerationStatus[]).includes(current.approvalStatus)) {
        throw new ValidationError(`Product in ${current.approvalStatus} status cannot be submitted`);
    }
    const now = dependencies.now();
    const moderationVersion = current.moderationVersion + 1;
    await safeBatch(db, [
        db.update(products).set({
            approvalStatus: "submitted",
            moderationVersion,
            updatedAt: now,
        }).where(and(eq(products.id, input.productId), eq(products.vendorId, input.vendorId))),
        db.insert(productModerationEvents).values(moderationEventValues({
            id: dependencies.id(),
            productId: input.productId,
            vendorId: input.vendorId,
            fromStatus: current.approvalStatus,
            toStatus: "submitted",
            actorUserId: input.actorUserId,
            moderationVersion,
            reason: "Seller submitted product for review",
            now,
        })),
    ]);
    return { approvalStatus: "submitted", moderationVersion };
}

type VendorVariantUpdateInput = z.infer<typeof updateVariantSchema>;

interface VendorVariantContext {
    id: string;
    productId: string;
    isDefault: boolean;
    size: string | null;
    color: string | null;
    weight: number | null;
    sku: string;
    price: number;
    stock: number;
    reservedStock: number;
    stockVersion: number;
    version: number;
    trackInventory: boolean;
    barcode: string | null;
    barcodeType: "ean13" | "upc" | "isbn" | "gtin" | "custom" | null;
    discountType: "percentage" | "flat" | null;
    discountPercentage: number | null;
    discountAmount: number | null;
}

function normalizedOption(value: string | null | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function normalizedNullable(value: string | null | undefined): string | null {
    return value?.trim() || null;
}

function variantCatalogChanged(
    current: VendorVariantContext,
    data: VendorVariantUpdateInput,
    effectivePrice: number,
): boolean {
    return current.size !== normalizedOption(data.size) ||
        current.color !== normalizedOption(data.color) ||
        current.weight !== data.weight ||
        current.sku !== data.sku.trim() ||
        current.price !== effectivePrice ||
        current.trackInventory !== (data.trackInventory ?? current.trackInventory) ||
        current.barcode !== normalizedNullable(data.barcode) ||
        current.barcodeType !== (data.barcodeType ?? null) ||
        (current.discountType ?? "percentage") !== (data.discountType ?? "percentage") ||
        (current.discountPercentage ?? 0) !== (data.discountPercentage ?? 0) ||
        (current.discountAmount ?? 0) !== (data.discountAmount ?? 0);
}

function buildGuardedVendorModerationEvent(
    db: Database,
    input: {
        id: string;
        productId: string;
        vendorId: string;
        variantId: string;
        expectedVariantVersion: number;
        expectedStockVersion: number;
        fromStatus: ProductModerationStatus;
        toStatus: ProductModerationStatus;
        actorUserId: string;
        moderationVersion: number;
        reason: string;
        now: Date;
    },
) {
    const guardProductId = sql`CASE WHEN EXISTS (
        SELECT 1
        FROM ${products}
        JOIN ${productVariants} ON ${productVariants.productId} = ${products.id}
        WHERE ${products.id} = ${input.productId}
          AND ${products.vendorId} = ${input.vendorId}
          AND ${products.approvalStatus} = ${input.toStatus}
          AND ${products.moderationVersion} = ${input.moderationVersion}
          AND ${productVariants.id} = ${input.variantId}
          AND ${productVariants.version} = ${input.expectedVariantVersion}
          AND ${productVariants.stockVersion} = ${input.expectedStockVersion}
          AND ${productVariants.deletedAt} IS NULL
      ) THEN ${input.productId} ELSE ${`__vendor_variant_guard_failed:${input.productId}`} END`;
    return db.insert(productModerationEvents).select(sql`
        SELECT
          ${input.id},
          ${guardProductId},
          ${input.vendorId},
          ${input.fromStatus},
          ${input.toStatus},
          ${input.reason},
          ${input.actorUserId},
          ${input.moderationVersion},
          ${JSON.stringify({ actorType: "vendor", source: "variant_update" })},
          ${Math.floor(input.now.getTime() / 1000)}
    `).returning({ id: productModerationEvents.id });
}

export async function listVendorProductVariants(
    db: Database,
    vendorId: string,
    productId: string,
) {
    await readOwnedProduct(db, vendorId, productId);
    return db.select({
        id: productVariants.id,
        productId: productVariants.productId,
        isDefault: productVariants.isDefault,
        size: productVariants.size,
        color: productVariants.color,
        weight: productVariants.weight,
        sku: productVariants.sku,
        price: productVariants.price,
        stock: productVariants.stock,
        reservedStock: productVariants.reservedStock,
        stockVersion: productVariants.stockVersion,
        version: productVariants.version,
        trackInventory: productVariants.trackInventory,
        barcode: productVariants.barcode,
        barcodeType: productVariants.barcodeType,
        discountType: productVariants.discountType,
        discountPercentage: productVariants.discountPercentage,
        discountAmount: productVariants.discountAmount,
        createdAt: productVariants.createdAt,
        updatedAt: productVariants.updatedAt,
    })
        .from(productVariants)
        .where(and(
            eq(productVariants.productId, productId),
            isNull(productVariants.deletedAt),
        ))
        .orderBy(productVariants.colorSortOrder, productVariants.sizeSortOrder, productVariants.createdAt)
        .all();
}

export async function updateVendorProductVariant(
    db: Database,
    input: {
        vendorId: string;
        productId: string;
        variantId: string;
        actorUserId: string;
        data: VendorVariantUpdateInput;
    },
    dependencies: VendorProductCommandDependencies = defaultDependencies,
): Promise<{
    variantId: string;
    stockVersion: number;
    version: number;
    approvalStatus: ProductModerationStatus;
    moderationVersion: number;
}> {
    const product = await readOwnedProduct(db, input.vendorId, input.productId);
    const variant = await db.select({
        id: productVariants.id,
        productId: productVariants.productId,
        isDefault: productVariants.isDefault,
        size: productVariants.size,
        color: productVariants.color,
        weight: productVariants.weight,
        sku: productVariants.sku,
        price: productVariants.price,
        stock: productVariants.stock,
        reservedStock: productVariants.reservedStock,
        stockVersion: productVariants.stockVersion,
        version: productVariants.version,
        trackInventory: productVariants.trackInventory,
        barcode: productVariants.barcode,
        barcodeType: productVariants.barcodeType,
        discountType: productVariants.discountType,
        discountPercentage: productVariants.discountPercentage,
        discountAmount: productVariants.discountAmount,
    })
        .from(productVariants)
        .where(and(
            eq(productVariants.id, input.variantId),
            eq(productVariants.productId, input.productId),
            isNull(productVariants.deletedAt),
        ))
        .get() as VendorVariantContext | undefined;
    if (!variant) throw new NotFoundError("Seller product variant not found");

    const size = normalizedOption(input.data.size);
    const color = normalizedOption(input.data.color);
    if (variant.isDefault && (size || color)) {
        throw new ValidationError("The simple seller SKU cannot be converted into an option variant");
    }
    if (!variant.isDefault && !size && !color) {
        throw new ValidationError("A seller option variant requires a size or color");
    }
    const duplicateSku = await db.select({ id: productVariants.id })
        .from(productVariants)
        .where(and(
            eq(productVariants.sku, input.data.sku.trim()),
            ne(productVariants.id, input.variantId),
            isNull(productVariants.deletedAt),
        ))
        .get();
    if (duplicateSku) throw new ConflictError("A variant with this SKU already exists");

    const effectivePrice = variant.isDefault ? product.price : input.data.price;
    const catalogChanged = variantCatalogChanged(variant, input.data, effectivePrice);
    const stockChanged = variant.stock !== input.data.stock;
    if (!catalogChanged && !stockChanged) {
        return {
            variantId: variant.id,
            stockVersion: variant.stockVersion,
            version: variant.version,
            approvalStatus: product.approvalStatus,
            moderationVersion: product.moderationVersion,
        };
    }

    const revision = catalogChanged
        ? revisionStatus(product.approvalStatus)
        : { nextStatus: product.approvalStatus, bumpModerationVersion: false, reason: null };
    const moderationVersion = revision.bumpModerationVersion
        ? product.moderationVersion + 1
        : product.moderationVersion;
    const nextVariantVersion = variant.version + 1;
    const nextStockVersion = stockChanged ? variant.stockVersion + 1 : variant.stockVersion;
    const now = dependencies.now();
    const statements: unknown[] = [];

    if (catalogChanged) {
        statements.push(db.update(products).set({
            approvalStatus: revision.nextStatus,
            moderationVersion,
            updatedAt: now,
        }).where(and(
            eq(products.id, input.productId),
            eq(products.vendorId, input.vendorId),
            eq(products.approvalStatus, product.approvalStatus),
            eq(products.moderationVersion, product.moderationVersion),
            isNull(products.deletedAt),
        )).returning({ id: products.id, moderationVersion: products.moderationVersion }));
    }

    if (stockChanged) {
        statements.push(buildStockMovementClaim(db, {
            movementId: dependencies.id(),
            variantId: input.variantId,
            stockVersion: variant.stockVersion,
            version: variant.version,
            strict: true,
            quantity: input.data.stock - variant.stock,
            previousStock: variant.stock,
            newStock: input.data.stock,
            notes: "Stocktake: seller variant edit",
            adminUserId: input.actorUserId,
        }));
    }

    const postModerationGuard = catalogChanged
        ? sql`EXISTS (
            SELECT 1 FROM ${products}
            WHERE ${products.id} = ${input.productId}
              AND ${products.vendorId} = ${input.vendorId}
              AND ${products.approvalStatus} = ${revision.nextStatus}
              AND ${products.moderationVersion} = ${moderationVersion}
              AND ${products.deletedAt} IS NULL
          )`
        : sql`1 = 1`;
    statements.push(db.update(productVariants).set({
        size,
        color,
        weight: input.data.weight,
        sku: input.data.sku.trim(),
        price: effectivePrice,
        stock: input.data.stock,
        stockVersion: stockChanged ? sql`${productVariants.stockVersion} + 1` : variant.stockVersion,
        version: sql`${productVariants.version} + 1`,
        trackInventory: input.data.trackInventory ?? variant.trackInventory,
        barcode: normalizedNullable(input.data.barcode),
        barcodeType: input.data.barcodeType ?? null,
        discountType: input.data.discountType ?? "percentage",
        discountPercentage: input.data.discountType === "flat" ? 0 : input.data.discountPercentage ?? 0,
        discountAmount: input.data.discountType === "flat" ? input.data.discountAmount ?? 0 : 0,
        updatedAt: now,
    }).where(and(
        eq(productVariants.id, input.variantId),
        eq(productVariants.productId, input.productId),
        eq(productVariants.version, variant.version),
        eq(productVariants.stockVersion, variant.stockVersion),
        isNull(productVariants.deletedAt),
        postModerationGuard,
    )).returning({
        id: productVariants.id,
        stockVersion: productVariants.stockVersion,
        version: productVariants.version,
    }));

    if (catalogChanged && revision.reason) {
        statements.push(buildGuardedVendorModerationEvent(db, {
            id: dependencies.id(),
            productId: input.productId,
            vendorId: input.vendorId,
            variantId: input.variantId,
            expectedVariantVersion: nextVariantVersion,
            expectedStockVersion: nextStockVersion,
            fromStatus: product.approvalStatus,
            toStatus: revision.nextStatus,
            actorUserId: input.actorUserId,
            moderationVersion,
            reason: revision.reason,
            now,
        }));
    }

    const results = await safeBatch(db, statements as never[]) as unknown[];
    let resultIndex = 0;
    if (catalogChanged) {
        const productRows = results[resultIndex++] as Array<{ id: string }> | undefined;
        if ((productRows?.length ?? 0) === 0) throw new ConflictError("Seller product changed concurrently");
    }
    if (stockChanged) {
        const movementRows = results[resultIndex++] as Array<{ id: string }> | undefined;
        if ((movementRows?.length ?? 0) === 0) throw new ConflictError("Seller stock changed concurrently");
    }
    const variantRows = results[resultIndex++] as Array<{ id: string; stockVersion: number; version: number }> | undefined;
    if ((variantRows?.length ?? 0) === 0) throw new ConflictError("Seller product variant changed concurrently");
    if (catalogChanged && revision.reason) {
        const eventRows = results[resultIndex] as Array<{ id: string }> | undefined;
        if ((eventRows?.length ?? 0) === 0) throw new ConflictError("Seller moderation event was not recorded");
    }
    if (stockChanged && input.data.stock < variant.stock) {
        await checkAndAlertLowStock(db, input.variantId);
    }
    return {
        variantId: input.variantId,
        stockVersion: nextStockVersion,
        version: nextVariantVersion,
        approvalStatus: revision.nextStatus,
        moderationVersion,
    };
}
