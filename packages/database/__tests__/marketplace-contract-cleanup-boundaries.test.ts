import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

const vendorOrdersSchema = source("../src/schema/vendor-orders.ts");
const vendorsSchema = source("../src/schema/vendors.ts");
const marketplaceFinanceSchema = source("../src/schema/marketplace-finance.ts");
const marketplacePayoutSchema = source("../src/schema/marketplace-payouts.ts");
const marketplaceShipmentSchema = source("../src/schema/marketplace-shipments.ts");
const orderSplitSource = source("../../core/src/modules/orders/vendor-order-split.ts");
const settlementSource = source("../../core/src/modules/marketplace/settlement.ts");
const payoutSource = source("../../core/src/modules/marketplace/payout.ts");
const financialBalanceSource = source("../../core/src/modules/marketplace/financial-balance.ts");

const forbiddenVendorOrderMoney = /(?:subtotal|commission|earning|payout|balance|amount|currency|rate_bps|rateBps)/i;

describe("marketplace contract cleanup boundaries", () => {
  it("keeps vendor_orders fulfillment-only with no seller money authority", () => {
    const tableBody = vendorOrdersSchema.slice(
      vendorOrdersSchema.indexOf("sqliteTable(\"vendor_orders\""),
      vendorOrdersSchema.indexOf("export type VendorOrder"),
    );
    expect(tableBody).not.toMatch(forbiddenVendorOrderMoney);
    expect(tableBody).toContain("fulfillmentStatus");
    expect(tableBody).toContain("deliveredAt");
  });

  it("keeps seller allocation writes free of copied financial totals", () => {
    const vendorOrderInsert = orderSplitSource.slice(
      orderSplitSource.indexOf("db.insert(vendorOrders)"),
      orderSplitSource.indexOf("return { vendorOrders"),
    );
    expect(vendorOrderInsert).not.toMatch(forbiddenVendorOrderMoney);
    expect(orderSplitSource).toContain("commissionMinor");
    expect(orderSplitSource).toContain("vendorNetMinor");
  });

  it("derives settlement and payout money from canonical ledger balances", () => {
    expect(settlementSource).toContain("marketplaceLedgerEntries");
    expect(settlementSource).toContain('"vendor_pending_payable"');
    expect(settlementSource).not.toMatch(/vendorOrders\.(?:subtotal|commission|earning|payout|balance|amount)/i);
    expect(payoutSource).toContain("getVendorFinancialBalance");
    expect(financialBalanceSource).toContain("marketplaceLedgerEntries");
    expect(financialBalanceSource).toContain("payoutEligibleMinor");
    expect(payoutSource).not.toMatch(/vendorOrders\.(?:subtotal|commission|earning|payout|balance|amount)/i);
  });

  it("keeps seller ownership membership-based and payout destinations encrypted", () => {
    const vendorIdentityBody = vendorsSchema.slice(
      vendorsSchema.indexOf("sqliteTable(\"vendors\""),
      vendorsSchema.indexOf("export const vendorUsers"),
    );
    expect(vendorIdentityBody).not.toMatch(/ownerId|owner_id/);
    expect(vendorsSchema).toContain('role: text("role"');
    expect(vendorsSchema).toContain('enum: ["owner", "admin", "catalog", "fulfillment", "finance", "viewer"]');
    expect(vendorsSchema).toContain('encryptedPayload: text("encrypted_payload").notNull()');
    expect(vendorsSchema).toContain('fingerprint: text("fingerprint").notNull()');
    expect(vendorsSchema).toContain('lastFour: text("last_four")');
    expect(vendorsSchema).not.toMatch(/accountNumber:\s*(?:text|integer|real)\(/);
  });

  it("uses integer minor-unit authority for every marketplace financial table", () => {
    for (const schema of [marketplaceFinanceSchema, marketplacePayoutSchema, marketplaceShipmentSchema]) {
      expect(schema).not.toContain("real(");
    }
    expect(marketplaceFinanceSchema).toContain("amountMinor");
    expect(marketplacePayoutSchema).toContain("amountMinor");
    expect(marketplaceShipmentSchema).toContain("shipmentAmountMinor");
  });
});
