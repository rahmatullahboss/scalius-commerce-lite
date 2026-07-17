import type { Database } from "@scalius/database/client";
import { settings } from "@scalius/database/schema";
import { ServiceUnavailableError } from "@scalius/core/errors";
import { eq } from "drizzle-orm";

export const MARKETPLACE_FLAG_CATEGORY = "marketplace" as const;
export const MARKETPLACE_FLAGS_CACHE_KEY = "gw:marketplace_flags:v1" as const;

export const MARKETPLACE_FLAG_KEYS = {
  vendorOnboardingWrite: "vendor_onboarding_write",
  vendorCatalogWrite: "vendor_catalog_write",
  publicVendorCatalog: "public_vendor_catalog",
  sellerOrderActions: "seller_order_actions",
  ledgerPosting: "ledger_posting",
  settlementRelease: "settlement_release",
  payoutWrite: "payout_write",
  vendorShipments: "vendor_shipments",
} as const;

export type MarketplaceFlagName = keyof typeof MARKETPLACE_FLAG_KEYS;
export type MarketplaceFlags = Record<MarketplaceFlagName, boolean>;

export const DEFAULT_MARKETPLACE_FLAGS: MarketplaceFlags = {
  vendorOnboardingWrite: false,
  vendorCatalogWrite: false,
  publicVendorCatalog: false,
  sellerOrderActions: false,
  ledgerPosting: false,
  settlementRelease: false,
  payoutWrite: false,
  vendorShipments: false,
};

type MarketplaceFlagRow = { key: string; value: string };

function parseBooleanSetting(value: string | null | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on", "enabled"].includes(value.trim().toLowerCase());
}

export function resolveMarketplaceFlags(rows: MarketplaceFlagRow[]): MarketplaceFlags {
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const flags = { ...DEFAULT_MARKETPLACE_FLAGS };

  for (const [flagName, settingKey] of Object.entries(MARKETPLACE_FLAG_KEYS) as Array<
    [MarketplaceFlagName, string]
  >) {
    flags[flagName] = parseBooleanSetting(values.get(settingKey));
  }

  return flags;
}

function resolveCachedMarketplaceFlags(value: string): MarketplaceFlags | null {
  try {
    const parsed = JSON.parse(value) as Partial<Record<MarketplaceFlagName, unknown>>;
    const rows = Object.entries(MARKETPLACE_FLAG_KEYS).map(([flagName, key]) => ({
      key,
      value: parsed[flagName as MarketplaceFlagName] === true ? "true" : "false",
    }));
    return resolveMarketplaceFlags(rows);
  } catch {
    return null;
  }
}

export async function getMarketplaceFlags(
  db: Database,
  kv?: KVNamespace | null,
): Promise<MarketplaceFlags> {
  if (kv) {
    try {
      const cached = await kv.get(MARKETPLACE_FLAGS_CACHE_KEY);
      if (cached) {
        const resolved = resolveCachedMarketplaceFlags(cached);
        if (resolved) return resolved;
      }
    } catch (error: unknown) {
      console.warn(
        "[MarketplaceFlags] KV read failed; falling back to D1:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  try {
    const rows = await db
      .select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.category, MARKETPLACE_FLAG_CATEGORY))
      .all();
    const flags = resolveMarketplaceFlags(rows);

    if (kv) {
      try {
        await kv.put(MARKETPLACE_FLAGS_CACHE_KEY, JSON.stringify(flags), {
          expirationTtl: 60,
        });
      } catch (error: unknown) {
        console.warn(
          "[MarketplaceFlags] KV write failed:",
          error instanceof Error ? error.message : error,
        );
      }
    }

    return flags;
  } catch (error: unknown) {
    console.warn(
      "[MarketplaceFlags] D1 read failed; all marketplace capabilities remain disabled:",
      error instanceof Error ? error.message : error,
    );
    return { ...DEFAULT_MARKETPLACE_FLAGS };
  }
}

export async function isMarketplaceFeatureEnabled(
  db: Database,
  flag: MarketplaceFlagName,
  kv?: KVNamespace | null,
): Promise<boolean> {
  const flags = await getMarketplaceFlags(db, kv);
  return flags[flag];
}

export async function assertMarketplaceFeatureEnabled(
  db: Database,
  flag: MarketplaceFlagName,
  kv?: KVNamespace | null,
): Promise<void> {
  if (!(await isMarketplaceFeatureEnabled(db, flag, kv))) {
    throw new ServiceUnavailableError(
      `Marketplace capability ${MARKETPLACE_FLAG_CATEGORY}.${MARKETPLACE_FLAG_KEYS[flag]} is disabled`,
    );
  }
}

export async function invalidateMarketplaceFlagsCache(
  kv?: KVNamespace | null,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.delete(MARKETPLACE_FLAGS_CACHE_KEY);
  } catch (error: unknown) {
    console.warn(
      "[MarketplaceFlags] KV delete failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
