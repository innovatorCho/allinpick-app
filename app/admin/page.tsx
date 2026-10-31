import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listAllProducts, countTrackers } from "@/lib/domain/products";
import { formatDateTime, formatKrw } from "@/lib/format";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { SeedDataButton } from "@/components/SeedDataButton";
import { countOpenErrors } from "@/lib/domain/errorLogs";
import { getSiteSettingsWithSources } from "@/lib/domain/siteSettings";

export default async function AdminPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다. 관리자로 등록된 계정으로 로그인해주세요.</p>;
  }

  const products = await listAllProducts();
  const trackerCounts = await Promise.all(products.map((p) => countTrackers(p.id)));
  const openErrorCount = await countOpenErrors();
  const { missingRequired } = await getSiteSettingsWithSources();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold">상품 관리</h1>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/admin/schedule"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            자동 재수집 스케줄
          </Link>
          <Link
            href="/admin/notifications"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            알림 관리
          </Link>
          <Link
            href="/admin/errors"
            className={
              openErrorCount > 0
                ? "rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                : "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            }
          >
            오류 로그{openErrorCount > 0 ? ` ${openErrorCount}` : ""}
          </Link>
          <Link
            href="/admin/settings"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            사이트 정보
          </Link>
          {process.env.NODE_ENV !== "production" && <SeedDataButton />}
        </div>
      </div>

      {missingRequired.length > 0 && (
        <p className="break-keep rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          개인정보 처리방침의 필수 정보({missingRequired.map((f) => f.label).join(", ")})가 비어 있어요.{" "}
          <Link href="/admin/settings" className="font-medium underline">
            사이트 정보에서 입력하기
          </Link>
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
            <tr>
              <th className="px-3 py-2">상품명</th>
              <th className="px-3 py-2">상품 ID</th>
              <th className="px-3 py-2">현재 가격</th>
              <th className="px-3 py-2">마지막 수집</th>
              <th className="px-3 py-2">수집 상태</th>
              <th className="px-3 py-2">추적 사용자</th>
              <th className="px-3 py-2">큐레이터 URL</th>
              <th className="px-3 py-2">관리</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-900">
                <td className="px-3 py-2">
                  <Link href={`/admin/products/${p.id}`} className="font-medium hover:underline">
                    {p.name}
                  </Link>
                  {p.isSeed && <span className="ml-1 text-xs text-zinc-400">(샘플)</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-zinc-500">{p.id}</td>
                <td className="px-3 py-2">{formatKrw(p.salePrice)}</td>
                <td className="px-3 py-2 text-xs text-zinc-500">{formatDateTime(p.lastCheckedAt)}</td>
                <td className="px-3 py-2">
                  <StatusBadge status={collectStatusLabel(p.lastCollectStatus)} ok={p.lastCollectStatus === "SUCCESS"} />
                </td>
                <td className="px-3 py-2">{trackerCounts[i]}명</td>
                <td className="px-3 py-2">
                  {p.curatorUrl ? (
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                      등록됨
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      미등록
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <Link
                    href={`/admin/products/${p.id}`}
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                  >
                    상세보기
                  </Link>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  등록된 상품이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatusBadge({ status, ok }: { status: string; ok: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        ok
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
          : "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      }`}
    >
      {status}
    </span>
  );
}
