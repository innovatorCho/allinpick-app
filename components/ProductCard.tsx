import Link from "next/link";
import { formatKrw } from "@/lib/format";
import { getPriceRange } from "@/lib/domain/priceHistory";
import { AWAITING_INFO_LABEL, isAwaitingFirstCollection } from "@/lib/collectStatusLabels";
import { PriceRangeBadge, getPriceRangeStatus } from "@/components/PriceRangeBadge";
import type { Product } from "@/lib/domain/types";

const PRICE_COLOR_BY_STATUS: Record<string, string> = {
  low: "text-blue-600 dark:text-blue-400",
  high: "text-zinc-400 dark:text-zinc-500",
};

export async function ProductCard({
  product,
  trackingUserCount,
}: {
  product: Product;
  trackingUserCount?: number;
}) {
  const range = await getPriceRange(product.id);
  const status = getPriceRangeStatus(product.salePrice, range);
  const priceColorClass = (status && PRICE_COLOR_BY_STATUS[status]) || "text-zinc-900 dark:text-zinc-100";
  // Registered but not collected yet: show it as in progress, not as a product called "상품 정보 확인 중".
  const awaitingInfo = isAwaitingFirstCollection(product);

  return (
    <Link
      href={`/product/${product.id}`}
      className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-400 dark:border-zinc-800 dark:bg-zinc-950 dark:hover:border-zinc-600"
    >
      <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-md bg-zinc-100 dark:bg-zinc-800">
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- external, unconfigured remote host
          <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {awaitingInfo ? (
          <>
            <p className="truncate text-xs text-zinc-500">올리브영 상품 {product.id}</p>
            <p className="mt-1 inline-block rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
              {AWAITING_INFO_LABEL}
            </p>
          </>
        ) : (
          <>
            <p className="truncate text-xs text-zinc-500">{product.brand}</p>
            <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{product.name}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {product.discountRate ? (
                <span className="text-sm font-semibold text-red-600">{product.discountRate}%</span>
              ) : null}
              <span className={`text-base font-bold ${priceColorClass}`}>{formatKrw(product.salePrice)}</span>
              <PriceRangeBadge price={product.salePrice} range={range} />
            </div>
          </>
        )}
        {trackingUserCount != null && (
          <p className="mt-0.5 text-xs text-zinc-500">{trackingUserCount.toLocaleString("ko-KR")}명이 가격 추적 중</p>
        )}
      </div>
    </Link>
  );
}
