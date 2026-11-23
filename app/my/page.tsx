import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listTrackingForUser } from "@/lib/domain/tracking";
import { getProductById } from "@/lib/domain/products";
import { getPriceRange } from "@/lib/domain/priceHistory";
import { countUnread } from "@/lib/domain/notifications";
import { ProductCard } from "@/components/ProductCard";
import { getPriceRangeStatus } from "@/components/PriceRangeBadge";
import { TrackedProductFilter, type TrackedItem } from "@/components/TrackedProductFilter";
import { isAwaitingFirstCollection } from "@/lib/collectStatusLabels";
import { PushSubscribeButton } from "@/components/PushSubscribeButton";
import { KakaoChannelButton } from "@/components/KakaoChannelButton";
import { getSiteSettings } from "@/lib/domain/siteSettings";
import { getVapidPublicKey } from "@/lib/webPush";
import { formatKrw } from "@/lib/format";

/** Below this many products, search and filters are more clutter than help. */
const FILTER_MIN_PRODUCTS = 3;

export default async function MyPage({ searchParams }: PageProps<"/my">) {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");
  const params = await searchParams;
  const param = (key: string) => (typeof params[key] === "string" ? params[key] : null);

  const tracking = await listTrackingForUser(currentUser.id);
  const trackedRaw = await Promise.all(
    tracking.map(async (t) => ({
      product: await getProductById(t.productId),
      range: await getPriceRange(t.productId),
      targetPrice: t.targetPrice,
    }))
  );
  const tracked = trackedRaw.filter(
    (t): t is typeof t & { product: NonNullable<typeof t.product> } => t.product != null
  );
  const items: TrackedItem[] = tracked.map(({ product, range, targetPrice }, order) => {
    const targetReached = targetPrice != null && product.salePrice != null && product.salePrice <= targetPrice;
    return {
      id: product.id,
      name: product.name,
      brand: product.brand,
      salePrice: product.salePrice,
      discountRate: product.discountRate,
      atLowest: getPriceRangeStatus(product.salePrice, range) === "low",
      targetPrice,
      targetReached,
      awaitingInfo: isAwaitingFirstCollection(product),
      order,
      card: (
        <div className="flex flex-col gap-1">
          <ProductCard product={product} range={range} />
          {targetPrice != null && (
            <p className="pl-1 text-xs text-zinc-500">
              목표 가격: {formatKrw(targetPrice)}
              {targetReached && <span className="ml-1.5 font-semibold text-emerald-600">🎯 목표 가격 도달</span>}
            </p>
          )}
        </div>
      ),
    };
  });
  const unreadCount = await countUnread(currentUser.id);
  const site = await getSiteSettings();
  const vapidPublicKey = getVapidPublicKey();

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">내 관심상품 ({currentUser.name})</h1>
        {tracked.length === 0 ? (
          <p className="text-sm text-zinc-500">추적 중인 상품이 없습니다. 상품을 검색하거나 URL을 등록해보세요.</p>
        ) : items.length < FILTER_MIN_PRODUCTS ? (
          <div className="flex flex-col gap-2">
            {items.map((i) => (
              <div key={i.id}>{i.card}</div>
            ))}
          </div>
        ) : (
          <TrackedProductFilter
            items={items}
            initialQuery={param("q") ?? ""}
            initialFilter={param("filter")}
            initialSort={param("sort")}
            initialPage={param("page")}
          />
        )}
      </section>

      {/* Notifications themselves open in the header bell's modal; /my#notifications
          (batched Kakao alerts, lib/kakaoBatch.ts) opens it too. */}
      <section id="alert-settings" className="flex scroll-mt-4 flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">알림 받기 설정</h2>
          <a
            href="#notifications"
            className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            받은 알림 보기{unreadCount > 0 && <span className="ml-1 text-red-600">{unreadCount}</span>}
          </a>
        </div>
        {vapidPublicKey && (
          <PushSubscribeButton vapidPublicKey={vapidPublicKey} notice={site.pushOptInNotice} iosNotice={site.pushIosNotice} />
        )}
        <KakaoChannelButton url={site.kakaoChannelUrl} label={site.kakaoChannelButtonLabel} />
      </section>
    </div>
  );
}
