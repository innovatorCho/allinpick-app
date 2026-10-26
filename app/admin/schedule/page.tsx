import { getCurrentUser } from "@/lib/session";
import { getSchedulerStatus, MIN_INTERVAL_MS, MAX_CONCURRENCY, MAX_PRODUCTS_PER_TICK } from "@/lib/priceScheduler";
import { listDueTrackedProducts } from "@/lib/domain/products";
import { formatDateTime } from "@/lib/format";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { toggleSchedulerAction, runSchedulerNowAction } from "@/lib/actions/admin-actions";
import { SchedulerConfigForm } from "@/components/SchedulerConfigForm";
import { SubmitButton } from "@/components/SubmitButton";

export default async function AdminSchedulePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  const status = await getSchedulerStatus();
  const statusLabel = !status.enabled ? "일시정지" : status.cycleInProgress ? "실행 중" : "대기 중";
  const currentlyDueCount = (await listDueTrackedProducts(new Date().toISOString())).length;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">가격 자동 재수집 스케줄</h1>
        <p className="mt-1 text-sm text-zinc-500">
          추적자가 있는 상품만 대상으로, 정해진 주기마다 자동으로 가격을 다시 확인합니다.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          아래 &quot;주기&quot;는 이 서버가 실제로 호출됐을 때 적용하는 설정값입니다 — 언제 호출되는지는
          app/api/cron/collect-prices를 누가 깨우느냐에 달려 있습니다(Vercel Cron, 외부 핑 서비스, 또는 로컬
          개발 중엔 자동 self-ping). Vercel Hobby 플랜의 자체 Cron은 하루 1번으로 제한되니, 이 주기만큼 자주
          확인하려면 외부 핑 서비스를 함께 설정해야 합니다.
        </p>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <span>
          상태:{" "}
          <span
            className={
              statusLabel === "실행 중"
                ? "font-medium text-emerald-600"
                : statusLabel === "일시정지"
                  ? "font-medium text-zinc-500"
                  : "font-medium text-zinc-700 dark:text-zinc-300"
            }
          >
            {statusLabel}
          </span>
        </span>
        <span>주기: {Math.round(status.intervalMs / 60000)}분</span>
        <span>동시 처리: {status.concurrency}개</span>
        <span>마지막 실행 시작: {formatDateTime(status.lastRunStartedAt)}</span>
        {status.lastRunDurationMs != null && (
          <span>마지막 소요 시간: {(status.lastRunDurationMs / 1000).toFixed(1)}초</span>
        )}
        <span className={currentlyDueCount > MAX_PRODUCTS_PER_TICK ? "font-medium text-amber-600" : undefined}>
          지금 확인 대기 중: {currentlyDueCount}개 (한 틱당 최대 {MAX_PRODUCTS_PER_TICK}개 처리)
        </span>
      </div>
      {currentlyDueCount > MAX_PRODUCTS_PER_TICK && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          대기 중인 상품이 한 틱 처리 상한보다 많습니다. 밀린 상품이 있다는 뜻이며, 오래 기다린 순서대로 여러 틱에
          걸쳐 처리됩니다. 계속 이 상태라면 주기를 줄이거나 동시 처리 개수를 늘려보세요.
        </p>
      )}

      <div className="flex gap-2">
        <form action={toggleSchedulerAction.bind(null, !status.enabled)}>
          <SubmitButton
            pendingText="처리 중..."
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {status.enabled ? "일시정지" : "재개"}
          </SubmitButton>
        </form>
        <form action={runSchedulerNowAction}>
          <SubmitButton
            pendingText="요청 중..."
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            지금 바로 실행
          </SubmitButton>
        </form>
      </div>
      {status.cycleInProgress && (
        <p className="text-xs text-zinc-500">실행 중입니다. 새로고침하면 진행 상황이 갱신됩니다.</p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">설정 변경</h2>
        <SchedulerConfigForm
          currentIntervalMinutes={Math.round(status.intervalMs / 60000)}
          currentConcurrency={status.concurrency}
          minIntervalMinutes={MIN_INTERVAL_MS / 60000}
          maxConcurrency={MAX_CONCURRENCY}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">마지막 실행 결과</h2>
        {status.lastRunResults.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 실행 기록이 없습니다 (서버 시작 후 첫 실행 전이거나, 대상 상품이 없습니다).</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {status.lastRunResults.map((r) => (
              <li key={r.productId} className="flex justify-between border-b border-zinc-100 py-1 dark:border-zinc-900">
                <span className="truncate pr-2">
                  {r.productId} &quot;{r.name}&quot;
                </span>
                <span className={r.status === "SUCCESS" ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"}>
                  {collectStatusLabel(r.status)}
                  {r.changeType ? ` (${r.changeType})` : ""}
                  {r.error ? ` — ${r.error}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
