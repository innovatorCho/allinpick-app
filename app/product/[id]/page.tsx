import { notFound } from "next/navigation";
import Link from "next/link";
import { getProductById, incrementViewCount, countTrackers } from "@/lib/domain/products";
import { listPriceHistory } from "@/lib/domain/priceHistory";
import { getTracking } from "@/lib/domain/tracking";
import { getCurrentUser } from "@/lib/session";
import { formatKrw, formatDateTime, formatDate } from "@/lib/format";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { PriceChart } from "@/components/PriceChart";
import { TrackButton } from "@/components/TrackButton";
import { TargetPriceForm } from "@/components/TargetPriceForm";

const CHANGE_LABEL: Record<string, string> = {
  initial: "최초 등록",
  increase: "가격 상승",
  decrease: "가격 하락",
  same: "변동 없음",
};

export default async function ProductDetailPage({ params }: PageProps<"/product/[id]">) {
  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  await incrementViewCount(id);

  const currentUser = await getCurrentUser();
  const history = await listPriceHistory(id);
  const recentChanges = [...history].reverse().slice(0, 5);
  const tracking = currentUser ? await getTracking(currentUser.id, id) : null;
  const trackerCount = await countTrackers(id);

  const isAdmin = currentUser?.role === "admin";
  const collectionFailed = product.lastCollectStatus && product.lastCollectStatus !== "SUCCESS";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-4">
        <div className="h-32 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-800">
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
          ) : null}
        </div>
        <div className="flex flex-col justify-center gap-1">
          <p className="text-sm text-zinc-500">{product.brand}</p>
          <h1 className="text-lg font-semibold">{product.name}</h1>
          <div className="flex items-baseline gap-2">
            {product.discountRate ? (
              <span className="text-xl font-bold text-red-600">{product.discountRate}%</span>
            ) : null}
            <span className="text-xl font-bold">{formatKrw(product.salePrice)}</span>
            {product.normalPrice != null && product.normalPrice !== product.salePrice && (
              <span className="text-sm text-zinc-400 line-through">{formatKrw(product.normalPrice)}</span>
            )}
          </div>
          <p className="text-xs text-zinc-500">가격 확인: {formatDateTime(product.lastCheckedAt)}</p>
          <p className="text-xs text-zinc-500">{trackerCount.toLocaleString("ko-KR")}명이 가격을 지켜보는 중</p>
        </div>
      </div>

      {collectionFailed && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p>최신 가격을 불러오지 못해 마지막으로 확인된 가격을 보여드리고 있어요.</p>
          {isAdmin && (
            <p className="mt-1 text-xs">
              {collectStatusLabel(product.lastCollectStatus)}: {product.lastCollectError}
            </p>
          )}
        </div>
      )}

      <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <PriceChart history={history} />
      </div>

      {recentChanges.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">최근 가격 변화</h2>
          <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
            {recentChanges.map((h) => (
              <li key={h.id} className="flex justify-between">
                <span>
                  {formatDate(h.recordedAt)} · {CHANGE_LABEL[h.changeType] ?? h.changeType}
                  {h.source === "seed" && <span className="ml-1 text-zinc-400">(샘플 데이터)</span>}
                </span>
                <span className="font-medium">{formatKrw(h.price)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {currentUser ? (
          <>
            <TrackButton productId={product.id} isTracking={tracking != null} />
            {tracking && <TargetPriceForm productId={product.id} currentTargetPrice={tracking.targetPrice} />}
          </>
        ) : (
          <Link
            href="/login"
            className="w-full rounded-lg border border-zinc-900 px-4 py-2 text-center text-sm font-medium text-zinc-900 hover:bg-zinc-900 hover:text-white dark:border-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
          >
            로그인하고 가격 알림 받기
          </Link>
        )}
        <a
          href={product.curatorUrl ?? product.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-medium text-white"
        >
          올리브영에서 구매하기
        </a>
      </div>
    </div>
  );
}
