const MARKETPLACE_TIME_ZONE = "Asia/Dhaka";

export function formatMarketplaceDate(value: unknown, fallback = "—"): string {
  if (value == null) return fallback;

  const date = value instanceof Date
    ? value
    : new Date(
        typeof value === "number"
          ? value < 10_000_000_000
            ? value * 1000
            : value
          : String(value),
      );

  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("en-US", {
    timeZone: MARKETPLACE_TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).format(date);
}
