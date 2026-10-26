import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { listTrackingForUser } from "@/lib/domain/tracking";
import { getProductById } from "@/lib/domain/products";
import { listNotificationsForUser, countUnread } from "@/lib/domain/notifications";
import { markNotificationReadAction, markAllNotificationsReadAction } from "@/lib/actions/notification-actions";
import { ProductCard } from "@/components/ProductCard";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDateTime, formatKrw } from "@/lib/format";

export default async function MyPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) redirect("/login");

  const tracking = await listTrackingForUser(currentUser.id);
  const trackedRaw = await Promise.all(
    tracking.map(async (t) => ({ product: await getProductById(t.productId), targetPrice: t.targetPrice }))
  );
  const tracked = trackedRaw.filter(
    (t): t is { product: NonNullable<typeof t.product>; targetPrice: number | null } => t.product != null
  );
  const notifications = await listNotificationsForUser(currentUser.id);
  const unreadCount = await countUnread(currentUser.id);
  const notificationProductNames = Object.fromEntries(
    await Promise.all(
      [...new Set(notifications.map((n) => n.productId))].map(
        async (productId) => [productId, (await getProductById(productId))?.name ?? productId] as const
      )
    )
  );

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">내 관심상품 ({currentUser.name})</h1>
        {tracked.length === 0 ? (
          <p className="text-sm text-zinc-500">추적 중인 상품이 없습니다. 상품을 검색하거나 URL을 등록해보세요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tracked.map(({ product, targetPrice }) => (
              <div key={product.id} className="flex flex-col gap-1">
                <ProductCard product={product} />
                {targetPrice != null && (
                  <p className="pl-1 text-xs text-zinc-500">목표 가격: {formatKrw(targetPrice)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            알림{unreadCount > 0 && <span className="ml-1 text-sm font-normal text-red-600">안 읽음 {unreadCount}건</span>}
          </h2>
          {unreadCount > 0 && (
            <form action={markAllNotificationsReadAction}>
              <SubmitButton
                pendingText="처리 중..."
                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                모두 읽음으로 표시
              </SubmitButton>
            </form>
          )}
        </div>

        {notifications.length === 0 ? (
          <p className="text-sm text-zinc-500">받은 알림이 없습니다.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={
                  n.isRead
                    ? "rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                    : "rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950"
                }
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {!n.isRead && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" aria-hidden />}
                    <Link href={`/product/${n.productId}`} className="font-medium hover:underline">
                      {notificationProductNames[n.productId] ?? n.productId}
                    </Link>
                  </div>
                  <span className="flex-shrink-0 text-xs text-zinc-400">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{n.message}</p>
                {!n.isRead && (
                  <form action={markNotificationReadAction.bind(null, n.id)} className="mt-2">
                    <SubmitButton
                      pendingText="처리 중..."
                      className="rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                    >
                      읽음으로 표시
                    </SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
