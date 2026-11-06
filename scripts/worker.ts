/**
 * Collector worker: `npm run worker`.
 *
 * Runs on a machine with a home internet connection (OliveYoung's bot check
 * blocks datacenter IPs like Vercel's — see lib/collectMode.ts) and does all
 * OliveYoung collecting for the deployed site, against the same Turso DB
 * from .env.local. No web server, no open port: the site writes what to
 * collect into the DB, this reads it.
 *
 * Every POLL_INTERVAL_MS it runs one scheduler cycle (lib/priceScheduler.ts),
 * which only touches products whose next_check_at is due:
 *  - newly registered products (next_check_at NULL) → picked up within ~30s;
 *  - price re-checks → every product's own interval, from the admin
 *    schedule settings (30 min by default, longer for stable products).
 * A cycle with nothing due is a single DB query.
 *
 * Admin settings (pause, concurrency) are re-read before every run, and the
 * worker reports its state to the DB every 30s (lib/domain/workerStatus.ts)
 * so the admin schedule page shows whether collection is running.
 *
 * Only one worker should run at a time; two would collect the same products.
 */
import { hostname } from "node:os";
import { runOneCycle } from "@/lib/priceScheduler";
import { listUncollectedTrackedProductIds, markDueNow } from "@/lib/domain/products";
import { saveWorkerStatus, type WorkerStatus } from "@/lib/domain/workerStatus";

const POLL_INTERVAL_MS = 30_000;

const status: WorkerStatus = {
  host: hostname(),
  startedAt: new Date().toISOString(),
  lastPollAt: new Date().toISOString(),
  cycleStartedAt: null,
  stoppedAt: null,
  lastRun: null,
};

/** A DB blip while reporting must never stop collection. */
async function reportStatus(): Promise<void> {
  status.lastPollAt = new Date().toISOString();
  try {
    await saveWorkerStatus(status);
  } catch (err) {
    console.error("[worker] 상태 기록 실패 (수집은 계속합니다):", err instanceof Error ? err.message : err);
  }
}

let stopping = false;
let wakeUp: (() => void) | null = null;

function stop(signal: string): void {
  if (stopping) process.exit(1); // second Ctrl+C: don't wait for the current product
  stopping = true;
  console.log(`[worker] ${signal} 받음 · 진행 중인 수집이 끝나면 종료합니다. (바로 끝내려면 한 번 더 누르세요)`);
  wakeUp?.();
}
process.on("SIGINT", () => stop("SIGINT"));
process.on("SIGTERM", () => stop("SIGTERM"));

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    wakeUp = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

async function main(): Promise<void> {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("[worker] TURSO_DATABASE_URL이 없습니다. .env.local을 확인해주세요.");
    process.exit(1);
  }
  // .env.local's APP_BASE_URL is localhost for `next dev`, but the links in
  // Kakao price alerts sent from here must open the deployed site.
  const siteUrl = process.env.WORKER_APP_BASE_URL?.trim();
  if (siteUrl) process.env.APP_BASE_URL = siteUrl;
  if (/localhost|127\.0\.0\.1/.test(process.env.APP_BASE_URL ?? "localhost")) {
    console.warn(
      "[worker] 경고: 알림 링크 주소가 localhost입니다. .env.local에 WORKER_APP_BASE_URL=<배포된 사이트 주소>를 추가해주세요."
    );
  }
  console.log(`[worker] 수집 프로그램 시작 · ${POLL_INTERVAL_MS / 1000}초마다 수집할 상품을 확인합니다. (종료: Ctrl+C)`);
  console.log(`[worker] 알림 링크 주소: ${process.env.APP_BASE_URL ?? "http://localhost:3000"}`);

  // Products that failed on Vercel sit in failure backoff (up to a day);
  // nobody should wait that long for a product's first data.
  const uncollected = await listUncollectedTrackedProductIds();
  for (const id of uncollected) await markDueNow(id);
  if (uncollected.length > 0) {
    console.log(`[worker] 아직 정보가 없는 상품 ${uncollected.length}개를 먼저 수집합니다.`);
  }

  await reportStatus();
  // Keeps lastPollAt fresh during a long run too, so the admin page doesn't
  // report the worker as stopped while it's busy collecting.
  const heartbeat = setInterval(() => void reportStatus(), POLL_INTERVAL_MS);

  while (!stopping) {
    status.cycleStartedAt = new Date().toISOString();
    const summary = await runOneCycle(undefined, { quietWhenIdle: true, reloadSettings: true });
    status.cycleStartedAt = null;
    if (summary) status.lastRun = summary;
    await reportStatus();
    if (!stopping) await sleep(POLL_INTERVAL_MS);
  }
  clearInterval(heartbeat);
  status.stoppedAt = new Date().toISOString();
  await reportStatus();
  console.log("[worker] 종료합니다.");
  process.exit(0); // the local browser (browserFetcher.ts) would otherwise keep the process alive
}

main().catch((err) => {
  console.error("[worker] 예상하지 못한 오류로 종료합니다:", err);
  process.exit(1);
});
