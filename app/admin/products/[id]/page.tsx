import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getProductById, countTrackers } from "@/lib/domain/products";
import { listPriceHistory, listCollectLogs } from "@/lib/domain/priceHistory";
import { formatDateTime, formatKrw } from "@/lib/format";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { CuratorUrlForm } from "@/components/CuratorUrlForm";
import { RecollectButton } from "@/components/RecollectButton";
import { DeleteProductButton } from "@/components/DeleteProductButton";
import { ServerlessCrawlerTestTool } from "@/components/ServerlessCrawlerTestTool";

const STATUS_LABEL: Record<string, string> = {
  initial: "정상",
  same: "정상",
  increase: "가격변경",
  decrease: "가격변경",
};

export default async function AdminProductDetailPage({ params }: PageProps<"/admin/products/[id]">) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  const { id } = await params;
  const product = await getProductById(id);
  if (!product) notFound();

  const [history, logs, trackerCount] = await Promise.all([
    listPriceHistory(id).then((h) => [...h].reverse()),
    listCollectLogs(id),
    countTrackers(id),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-zinc-500">{product.brand}</p>
            <h1 className="text-lg font-semibold">{product.name}</h1>
          </div>
          <Link
            href={`/product/${product.id}`}
            target="_blank"
            className="flex-shrink-0 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            상품 상세정보 보기
          </Link>
        </div>
        <p className="mt-1 font-mono text-xs text-zinc-500">{product.id}</p>
        <div className="mt-2 flex flex-wrap gap-4 text-sm text-zinc-600 dark:text-zinc-400">
          <span>현재가 {formatKrw(product.salePrice)}</span>
          <span>마지막 수집 {formatDateTime(product.lastCheckedAt)}</span>
          <span>상태 {collectStatusLabel(product.lastCollectStatus)}</span>
          <span>추적 사용자 {trackerCount}명</span>
        </div>
        <div className="mt-1 flex flex-wrap gap-4 text-xs text-zinc-400">
          <span>다음 자동 확인 예정: {formatDateTime(product.nextCheckAt)}</span>
          {product.consecutiveFailures > 0 && <span>연속 실패 {product.consecutiveFailures}회 (자동 확인 간격이 늘어난 상태)</span>}
          {product.consecutiveSameCount > 0 && <span>가격 변동 없음 {product.consecutiveSameCount}회 연속</span>}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">가격 수집 관리</h2>
        <RecollectButton productId={product.id} />
        {product.lastCollectError && (
          <p className="text-xs text-amber-700 dark:text-amber-400">최근 오류: {product.lastCollectError}</p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">큐레이터 URL 관리</h2>
        <CuratorUrlForm productId={product.id} currentUrl={product.curatorUrl} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Vercel 이전 검증</h2>
        <ServerlessCrawlerTestTool productId={product.id} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">가격 이력</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">날짜</th>
                <th className="px-3 py-2">가격</th>
                <th className="px-3 py-2">상태</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-3 py-2 text-xs text-zinc-500">{formatDateTime(h.recordedAt)}</td>
                  <td className="px-3 py-2">{formatKrw(h.price)}</td>
                  <td className="px-3 py-2">
                    {STATUS_LABEL[h.changeType] ?? h.changeType}
                    {h.source === "seed" && <span className="ml-1 text-zinc-400">(샘플)</span>}
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                    가격 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">상품 삭제</h2>
        <p className="text-xs text-zinc-500">
          잘못 등록됐거나 더 이상 판매하지 않는 상품을 지웁니다. 가격 이력과 사용자들의 추적도 함께 지워집니다.
        </p>
        <DeleteProductButton productId={product.id} trackerCount={trackerCount} />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">수집 시도 로그</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {logs.map((log) => (
            <li key={log.id} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
              <span className="text-xs text-zinc-500">{formatDateTime(log.createdAt)}</span>
              <span className={log.status === "SUCCESS" ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"}>
                {collectStatusLabel(log.status)}
                {log.errorMessage ? ` — ${log.errorMessage}` : ""}
              </span>
            </li>
          ))}
          {logs.length === 0 && <li className="text-zinc-500">수집 시도 기록이 없습니다.</li>}
        </ul>
      </div>
    </div>
  );
}
