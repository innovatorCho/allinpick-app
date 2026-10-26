export type PriceRangeStatus = "low" | "high" | "mid" | null;

/** Where the current price sits relative to the all-time low/high — shared so ProductCard can color the price number itself, not just the badge. */
export function getPriceRangeStatus(
  price: number | null,
  range: { min: number; max: number } | null
): PriceRangeStatus {
  if (price == null || !range || range.min === range.max) return null;
  if (price <= range.min) return "low";
  if (price >= range.max) return "high";
  return "mid";
}

/**
 * Shows how the current price compares to the lowest/highest ever recorded
 * for this product — a solid, high-contrast pill for the two states that
 * actually matter (all-time low/high), not a light tint easy to miss next
 * to a bold price number.
 */
export function PriceRangeBadge({
  price,
  range,
}: {
  price: number | null;
  range: { min: number; max: number } | null;
}) {
  const status = getPriceRangeStatus(price, range);

  if (status === "low") {
    return (
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-blue-600 px-2 py-0.5 text-xs font-bold text-white">
        <span aria-hidden>▼</span>최저가
      </span>
    );
  }

  if (status === "high") {
    return (
      <span className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-full bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">
        <span aria-hidden>▲</span>최고가
      </span>
    );
  }

  if (status === "mid" && price != null && range) {
    const pctAboveMin = Math.round(((price - range.min) / range.min) * 100);
    return (
      <span className="inline-flex items-center whitespace-nowrap rounded-full bg-orange-100 px-2 py-0.5 text-xs font-bold text-orange-700 dark:bg-orange-950 dark:text-orange-300">
        최저가 대비 +{pctAboveMin}%
      </span>
    );
  }

  return null;
}
