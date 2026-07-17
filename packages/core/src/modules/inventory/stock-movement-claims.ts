import { inventoryMovements, productVariants } from "@scalius/database/schema";
import type { Database } from "@scalius/database/client";
import { sql } from "drizzle-orm";

export function buildStockMovementClaim(
  db: Database,
  params: {
    movementId: string;
    variantId: string;
    stockVersion: number;
    version?: number;
    strict?: boolean;
    quantity: number;
    previousStock: number;
    newStock: number;
    notes: string;
    adminUserId?: string;
  },
) {
  const versionCondition = params.version == null
    ? sql``
    : sql`AND ${productVariants.version} = ${params.version}`;
  const matchingVariant = sql`
    ${productVariants.id} = ${params.variantId}
    AND ${productVariants.stockVersion} = ${params.stockVersion}
    ${versionCondition}
    AND ${productVariants.deletedAt} IS NULL
  `;
  const guardedVariantId = params.strict
    ? sql`CASE WHEN EXISTS (
        SELECT 1 FROM ${productVariants} WHERE ${matchingVariant}
      ) THEN ${params.variantId} ELSE ${`__stock_guard_failed:${params.variantId}`} END`
    : sql`${params.variantId}`;

  return db
    .insert(inventoryMovements)
    .select(sql`
      SELECT
        ${params.movementId},
        ${guardedVariantId},
        NULL,
        ${"adjusted"},
        ${params.quantity},
        ${params.previousStock},
        ${params.newStock},
        ${params.notes},
        ${params.adminUserId ?? null},
        unixepoch()
      ${params.strict ? sql`` : sql`FROM ${productVariants} WHERE ${matchingVariant}`}
    `)
    .returning({ id: inventoryMovements.id });
}
