import { getCurrentUser } from "@/lib/session";
import { getSchedulerStatus, MIN_INTERVAL_MS, MAX_CONCURRENCY, MAX_PRODUCTS_PER_TICK } from "@/lib/priceScheduler";
import { loadSchedulerSettings } from "@/lib/domain/schedulerSettings";
import { listDueTrackedProducts } from "@/lib/domain/products";
import { getWorkerStatus, isWorkerOnline, type WorkerStatus } from "@/lib/domain/workerStatus";
import { canCollectHere } from "@/lib/collectMode";
import { cooldownPhase, getBotBlockCooldown, BOT_BLOCK_WAIT_STEPS_MIN, type BotBlockCooldown } from "@/lib/domain/botBlockCooldown";
import { formatDateTime } from "@/lib/format";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { toggleSchedulerAction, runSchedulerNowAction, endBotBlockWaitAction } from "@/lib/actions/admin-actions";
import { SchedulerConfigForm } from "@/components/SchedulerConfigForm";
import { SubmitButton } from "@/components/SubmitButton";

function minutesAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}시간 전` : `${Math.floor(hours / 24)}일 전`;
}

/** Whether the collector worker (scripts/worker.ts) is running, and what its last run did. */
function WorkerStatusPanel({ worker }: { worker: WorkerStatus | null }) {
  const online = isWorkerOnline(worker);
  const state = !worker
    ? { label: "기록 없음", className: "text-zinc-500" }
    : online
      ? { label: worker.cycleStartedAt ? "실행 중 · 수집하는 중" : "실행 중 · 대기", className: "text-emerald-600" }
      : worker.stoppedAt
        ? { label: "종료됨", className: "text-red-600" }
        : { label: "응답 없음", className: "text-red-600" };
  const run = worker?.lastRun;

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">수집 프로그램</h2>
      <div className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>
            상태: <span className={`font-medium ${state.className}`}>{state.label}</span>
          </span>
          {worker && (
            <>
              <span>컴퓨터: {worker.host}</span>
              <span>시작: {formatDateTime(worker.startedAt)}</span>
              <span>
                {worker.stoppedAt ? `종료: ${formatDateTime(worker.stoppedAt)}` : `마지막 신호: ${minutesAgo(worker.lastPollAt)}`}
              </span>
            </>
          )}
        </div>
        {run && (
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            <span>마지막 수집: {formatDateTime(run.finishedAt)} ({minutesAgo(run.finishedAt)})</span>
            <span>
              대상 {run.total} · 성공 <span className="text-emerald-600">{run.succeeded}</span> · 실패{" "}
              <span className={run.failed > 0 ? "text-amber-700 dark:text-amber-400" : undefined}>{run.failed}</span>
              {run.botBlocked > 0 && <span className="text-red-600"> (차단 {run.botBlocked})</span>}
              {run.skipped > 0 && <> · 미처리 {run.skipped}</>} · 가격 하락 {run.priceDrops}
            </span>
          </div>
        )}
      </div>
      {!online && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          수집 프로그램이 실행되고 있지 않아 가격 확인과 새 상품 정보 수집이 멈춰 있습니다. 수집용 컴퓨터의 터미널에서{" "}
          <code className="rounded bg-red-100 px-1 dark:bg-red-900">caffeinate -i npm run worker</code>를 실행해주세요.
        </p>
      )}
      {run && run.botBlocked > 0 && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          마지막 수집에서 올리브영 차단이 있었습니다. 자주 반복되면 동시 처리 개수를 1로 낮추거나 주기를 늘려주세요.
        </p>
      )}
    </div>
  );
}

/** Shown while OliveYoung's bot check has paused all collection (lib/domain/botBlockCooldown.ts). */
function BotBlockPanel({ cooldown }: { cooldown: BotBlockCooldown }) {
  const waiting = cooldownPhase(cooldown) === "waiting";
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      <p className="font-medium">올리브영 차단으로 수집을 멈춘 상태입니다 ({cooldown.level}단계)</p>
      <p>
        {waiting
          ? `${formatDateTime(cooldown.until)}까지 요청을 보내지 않고, 그다음 상품 1개로 차단이 풀렸는지 확인합니다.`
          : "대기 시간이 끝났습니다. 수집 프로그램의 다음 확인 때 상품 1개로 차단이 풀렸는지 확인합니다."}{" "}
        풀렸으면 정상 수집을 재개하고, 아직이면 더 오래 기다립니다 (대기 시간:{" "}
        {BOT_BLOCK_WAIT_STEPS_MIN.map((m) => (m < 60 ? `${m}분` : `${m / 60}시간`)).join(" → ")}).
      </p>
      <p className="text-xs">처음 차단: {formatDateTime(cooldown.blockedAt)}</p>
      {waiting && (
        <form action={endBotBlockWaitAction}>
          <SubmitButton
            pendingText="요청 중..."
            className="rounded-lg border border-amber-400 px-3 py-1.5 text-sm font-medium hover:bg-amber-100 disabled:opacity-50 dark:border-amber-700 dark:hover:bg-amber-900"
          >
            기다리지 않고 지금 확인
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

export default async function AdminSchedulePage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  // This server's own scheduler state only means something where it collects
  // (local dev). On Vercel the worker collects, so settings come straight
  // from the DB and run status from the worker's own report.
  const collectsHere = canCollectHere();
  const [status, settings, worker, due, cooldown] = await Promise.all([
    getSchedulerStatus(),
    loadSchedulerSettings(),
    getWorkerStatus(),
    listDueTrackedProducts(new Date().toISOString()),
    getBotBlockCooldown(),
  ]);
  const currentlyDueCount = due.length;
  const statusLabel = !settings.enabled ? "일시정지" : collectsHere && status.cycleInProgress ? "실행 중" : "켜짐";

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">가격 자동 재수집 스케줄</h1>
        <p className="mt-1 text-sm text-zinc-500">
          추적자가 있는 상품만 대상으로, 정해진 주기마다 자동으로 가격을 다시 확인합니다.
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          올리브영 수집은 수집용 컴퓨터에서 실행하는 수집 프로그램(npm run worker)이 합니다. 30초마다 확인할 상품이
          있는지 보고, 아래 설정(일시정지, 주기, 동시 처리)은 다음 확인 때부터 바로 적용됩니다.
        </p>
      </div>

      <WorkerStatusPanel worker={worker} />
      {cooldown && <BotBlockPanel cooldown={cooldown} />}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">스케줄</h2>
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <span>
            상태:{" "}
            <span
              className={
                statusLabel === "일시정지" ? "font-medium text-zinc-500" : "font-medium text-emerald-600"
              }
            >
              {statusLabel}
            </span>
          </span>
          <span>주기: {Math.round(settings.intervalMs / 60000)}분</span>
          <span>동시 처리: {settings.concurrency}개</span>
          {collectsHere && <span>마지막 실행 시작: {formatDateTime(status.lastRunStartedAt)}</span>}
          {collectsHere && status.lastRunDurationMs != null && (
            <span>마지막 소요 시간: {(status.lastRunDurationMs / 1000).toFixed(1)}초</span>
          )}
          <span className={currentlyDueCount > MAX_PRODUCTS_PER_TICK ? "font-medium text-amber-600" : undefined}>
            지금 확인 대기 중: {currentlyDueCount}개 (한 번에 최대 {MAX_PRODUCTS_PER_TICK}개 처리)
          </span>
        </div>
      </div>
      {currentlyDueCount > MAX_PRODUCTS_PER_TICK && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          대기 중인 상품이 한 번에 처리할 수 있는 개수보다 많습니다. 밀린 상품이 있다는 뜻이며, 오래 기다린 순서대로
          여러 번에 걸쳐 처리됩니다. 계속 이 상태라면 주기를 늘려보세요.
        </p>
      )}

      <div className="flex gap-2">
        <form action={toggleSchedulerAction.bind(null, !settings.enabled)}>
          <SubmitButton
            pendingText="처리 중..."
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {settings.enabled ? "일시정지" : "재개"}
          </SubmitButton>
        </form>
        {/* Only where this server collects itself; the worker already checks every 30s. */}
        {collectsHere && (
          <form action={runSchedulerNowAction}>
            <SubmitButton
              pendingText="요청 중..."
              className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              지금 바로 실행
            </SubmitButton>
          </form>
        )}
      </div>
      {collectsHere && status.cycleInProgress && (
        <p className="text-xs text-zinc-500">실행 중입니다. 새로고침하면 진행 상황이 갱신됩니다.</p>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">설정 변경</h2>
        <SchedulerConfigForm
          currentIntervalMinutes={Math.round(settings.intervalMs / 60000)}
          currentConcurrency={settings.concurrency}
          minIntervalMinutes={MIN_INTERVAL_MS / 60000}
          maxConcurrency={MAX_CONCURRENCY}
        />
      </div>

      {collectsHere && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">이 서버의 마지막 실행 결과</h2>
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
      )}
    </div>
  );
}
