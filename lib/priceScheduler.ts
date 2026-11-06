import { listDueTrackedProducts, getProductById } from "@/lib/domain/products";
import { recordError } from "@/lib/domain/errorLogs";
import { recollectProduct, type Collector } from "@/lib/domain/collection";
import { withRenderSession } from "@/collectors/oliveyoung/renderPage";
import { errorDetail, newRunId, resourceSnapshot, runLog, runWarn, seconds, withRunLog } from "@/lib/runLog";
import { collectFailureCategory } from "@/lib/collectFailureCategory";
import { canCollectHere } from "@/lib/collectMode";
import {
  clearBotBlockCooldown,
  cooldownPhase,
  getBotBlockCooldown,
  startBotBlockCooldown,
  type BotBlockCooldown,
} from "@/lib/domain/botBlockCooldown";
import {
  loadSchedulerSettings,
  persistConcurrency,
  persistEnabled,
  persistIntervalMs,
  DEFAULT_CONCURRENCY,
  MAX_CONCURRENCY,
  MIN_INTERVAL_MS,
} from "@/lib/domain/schedulerSettings";
import { DbConnectionError, DbConfigError } from "@/lib/db/client";
import { runAfterResponse } from "@/lib/runAfterResponse";
import type { CollectStatus, PriceChangeType, Product } from "@/lib/domain/types";
import type { CycleSummary } from "@/lib/domain/workerStatus";

export { MIN_INTERVAL_MS, MAX_CONCURRENCY, DEFAULT_CONCURRENCY };

/**
 * Background re-collection — one call to `runOneCycle()` processes every
 * tracked product whose `next_check_at` is due (lib/domain/collectionSchedule.ts
 * computes that per-product timing from tracker count, recent price
 * volatility, and failure backoff — the "diverse criteria" this scheduler
 * uses to decide *what to check*).
 *
 * *When* it runs is no longer this module's job — it used to self-schedule
 * via `setInterval` from instrumentation.ts, which assumed a single
 * long-running Node process. Vercel's serverless functions don't keep one
 * alive like that (an instance can freeze/recycle between requests, and
 * scaling to several instances would've meant several independent timers
 * all firing the same job), so triggering moved to app/api/cron/collect-prices
 * — called by Vercel Cron (vercel.json), an external pinger, or (locally)
 * instrumentation.ts's self-ping. `runOneCycle` itself doesn't know or care
 * which — it's the exact same function either way.
 *
 * What it deliberately does NOT do: vary request timing/headers/identity to
 * make the traffic harder to recognize as automated. That was explicitly
 * requested and declined (see chat history) — this stays an ordinary,
 * identifiable headless-browser client.
 *
 * Concurrency within a cycle (a small bounded worker pool instead of one
 * product at a time) is purely a performance choice to shorten cycle time,
 * unrelated to the point above.
 */

/**
 * Upper bound on how many due products one tick will process. Without this,
 * a growing backlog (more tracked products than one tick can finish before
 * the next is due) makes every subsequent tick get skipped entirely — see
 * lib/domain/products.ts's listDueTrackedProducts doc comment. Capping keeps
 * a tick's own runtime bounded (even at MIN_INTERVAL_MS and MAX_CONCURRENCY,
 * 50 products comfortably finishes well inside a 5-minute tick), so ticks
 * never overlap on their own and a backlog gets worked through steadily,
 * oldest-overdue-first, instead of the whole thing being delayed together.
 */
export const MAX_PRODUCTS_PER_TICK = 50;

/**
 * Circuit breaker against a real, observed failure mode: forcing a burst of
 * products due at once got this app's IP actively blocked by Cloudflare for
 * a sustained window (tens of minutes+), not just a single flaky request —
 * confirmed by retrying an already-blocked product in total isolation and
 * getting blocked again (see chat history). Continuing to burn through the
 * rest of a tick's queue while already blocked only wastes requests and
 * plausibly keeps reinforcing the block.
 *
 * Once this many BOT_BLOCKED results land in one run, the run stops and a
 * pause on all requests starts (lib/domain/botBlockCooldown.ts): 30 minutes,
 * then longer while the block persists. Products not reached stay due.
 * While probing whether a block has lifted, a single BOT_BLOCKED is enough.
 */
const BOT_BLOCK_CIRCUIT_BREAKER_THRESHOLD = 2;

export interface SchedulerRunResult {
  productId: string;
  name: string;
  status: CollectStatus;
  changeType: PriceChangeType | null;
  error?: string;
  nextCheckAt: string | null;
}

export interface SchedulerStatus {
  enabled: boolean;
  intervalMs: number;
  concurrency: number;
  cycleInProgress: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunDurationMs: number | null;
  lastRunResults: SchedulerRunResult[];
}

declare global {
  var __allinpickSchedulerState: SchedulerState | undefined;
}

interface SchedulerState {
  intervalMs: number;
  enabled: boolean;
  concurrency: number;
  settingsLoaded: boolean;
  cycleInProgress: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunDurationMs: number | null;
  lastRunResults: SchedulerRunResult[];
}

function getState(): SchedulerState {
  if (!globalThis.__allinpickSchedulerState) {
    globalThis.__allinpickSchedulerState = {
      intervalMs: MIN_INTERVAL_MS,
      enabled: true,
      concurrency: DEFAULT_CONCURRENCY,
      settingsLoaded: false,
      cycleInProgress: false,
      lastRunStartedAt: null,
      lastRunFinishedAt: null,
      lastRunDurationMs: null,
      lastRunResults: [],
    };
  }
  return globalThis.__allinpickSchedulerState;
}

/**
 * Lazily loads persisted admin settings (interval/enabled/concurrency) into
 * `state`, once per process — replaces the old one-time load that used to
 * run at server boot. Needed because there's no single "boot" moment
 * anymore: a serverless cold start's first request IS the boot moment, and
 * this covers that the same way a long-running dev server's first tick used to.
 */
async function ensureSettingsLoaded(): Promise<SchedulerState> {
  const state = getState();
  if (state.settingsLoaded) return state;

  try {
    const settings = await loadSchedulerSettings();
    state.intervalMs = settings.intervalMs;
    state.enabled = settings.enabled;
    state.concurrency = settings.concurrency;
  } catch (err) {
    // DB unreachable — don't crash the caller over it; keep the in-memory
    // defaults already in `state` and let the next call retry (not marking
    // settingsLoaded lets that happen automatically).
    console.error(
      "[price-scheduler] 설정을 불러오지 못해 기본값을 사용합니다 (DB 연결 확인 필요):",
      err instanceof Error ? err.message : err
    );
    return state;
  }
  state.settingsLoaded = true;
  return state;
}

/**
 * Simple bounded-concurrency worker pool — a performance choice, not a
 * stealth one (see module doc comment). `onResult` lets the caller react as
 * each item finishes (used below to count BOT_BLOCKED results); `shouldAbort`
 * is checked before a worker picks up its next item, so returning true stops
 * new work from starting without killing in-flight requests — items never
 * reached stay `undefined` in the returned array (still due, so the next
 * tick naturally picks them back up — see runOneCycle's circuit breaker).
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
  options?: { onResult?: (result: R, item: T) => void; shouldAbort?: () => boolean }
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      if (options?.shouldAbort?.()) return;
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      const result = await fn(items[current]);
      results[current] = result;
      options?.onResult?.(result, items[current]);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function collectOne(product: Product, position: string, collector?: Collector): Promise<SchedulerRunResult> {
  const started = Date.now();
  runLog(`${position} 시작 ${product.id} "${product.name}"`);
  const result = await collectOneInner(product, collector);
  const elapsed = seconds(Date.now() - started);
  const next = result.nextCheckAt ? ` · 다음 확인 ${result.nextCheckAt}` : "";
  if (result.status === "SUCCESS") {
    const change = result.changeType ? ` · 가격 ${CHANGE_LABEL[result.changeType] ?? result.changeType}` : "";
    runLog(`${position} 성공 ${product.id} (${elapsed})${change}${next} · ${resourceSnapshot()}`);
  } else {
    const cause = collectFailureCategory(result.status, result.error);
    runWarn(
      `${position} 실패 ${product.id} (${elapsed}) · ${result.status} · 원인: ${cause}${next} · ${resourceSnapshot()}` +
        (result.error ? `\n${errorDetail(result.error)}` : "")
    );
  }
  return result;
}

/** "14:05" in Korean time, for log lines about when the block pause ends. */
function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
}

const CHANGE_LABEL: Record<string, string> = { initial: "최초", increase: "상승", decrease: "하락", same: "변동 없음" };

async function collectOneInner(product: Product, collector?: Collector): Promise<SchedulerRunResult> {
  try {
    const outcome = await recollectProduct(product.id, collector);
    const updated = await getProductById(product.id);
    return {
      productId: product.id,
      name: product.name,
      status: outcome.collectResult.status,
      changeType: outcome.changeType,
      // Was missing: failed collections reached the logs and the admin
      // schedule page with no error text at all, only "NETWORK_ERROR".
      error: outcome.collectResult.status === "SUCCESS" ? undefined : outcome.collectResult.error,
      nextCheckAt: updated?.nextCheckAt ?? null,
    };
  } catch (err) {
    // Includes DbConnectionError now that the DB is a network call (Turso) —
    // one product's DB hiccup must never take down the whole tick or process,
    // same as a crawl failure always has: record it as a normal failed
    // result and let the next tick retry this product naturally.
    // Normal crawl failures come back as a status, not an exception, so
    // landing here means something unexpected — worth an admin's look.
    await recordError({ source: "scheduler:product", error: err, context: { productId: product.id } });
    return {
      productId: product.id,
      name: product.name,
      status: "FAILED",
      changeType: null,
      error: err instanceof Error ? err.message : "알 수 없는 오류",
      nextCheckAt: null,
    };
  }
}

/**
 * Called by app/api/cron/collect-prices/route.ts — see module doc comment
 * for who triggers that and when. `collector` is only ever passed in tests
 * (scripts/verify/test-circuit-breaker.ts) — real callers never pass it, so
 * `collectOne` falls through to the real collectOliveYoungProduct.
 */
/**
 * A cycle that's been "in progress" this long is assumed dead: its function
 * was killed (timeout, crash) before the `finally` below could clear the
 * flag. Without this, a reused serverless instance would skip every later
 * cycle forever. Comfortably longer than any real cycle (max ~5 minutes).
 */
const STALE_CYCLE_MS = 10 * 60_000;

/**
 * How long before the platform's hard limit a cycle stops *starting* new
 * products, so in-flight work finishes and is saved instead of the whole
 * run being killed mid-way. On Vercel each page is capped at 55s
 * (SESSION_FETCH_HARD_TIMEOUT_MS) and pages render one at a time, so with
 * up to 2 workers queued at the cutoff the tail is at most ~110s.
 */
export const CYCLE_START_CUTOFF_MARGIN_MS = 120_000;

export interface RunCycleOptions {
  /** Epoch ms after which no new product is started; the rest stay due for the next run. */
  stopStartingAt?: number;
  /** Log nothing when no product is due (the worker polls every 30s). */
  quietWhenIdle?: boolean;
  /**
   * Re-read the admin settings (pause, concurrency) before this run. The
   * worker is one long-lived process; without this an admin change would
   * only take effect after restarting it.
   */
  reloadSettings?: boolean;
}

/** Returns what this run did, or null when it didn't collect anything (paused, skipped, nothing due). */
export async function runOneCycle(collector?: Collector, options: RunCycleOptions = {}): Promise<CycleSummary | null> {
  const runId = newRunId();
  return withRunLog("collect", runId, () => runOneCycleLogged(collector, options));
}

async function runOneCycleLogged(collector: Collector | undefined, options: RunCycleOptions): Promise<CycleSummary | null> {
  if (options.reloadSettings) getState().settingsLoaded = false;
  const state = await ensureSettingsLoaded();

  if (!canCollectHere()) {
    // Covers the cron route, external pingers and the admin "지금 바로 실행"
    // button alike: on Vercel every attempt only timed out (lib/collectMode.ts).
    runLog("건너뜀: 이 서버에서는 수집하지 않습니다. 수집은 수집 프로그램(npm run worker)이 합니다.");
    return null;
  }
  if (!state.enabled) {
    if (!options.quietWhenIdle) runLog("건너뜀: 스케줄러가 일시정지 상태입니다.");
    return null;
  }
  const stale =
    state.cycleInProgress &&
    state.lastRunStartedAt != null &&
    Date.now() - new Date(state.lastRunStartedAt).getTime() > STALE_CYCLE_MS;
  if (stale) {
    runWarn(`이전 실행(${state.lastRunStartedAt} 시작)이 비정상 종료된 것으로 보여 진행 중 표시를 해제합니다.`);
  } else if (state.cycleInProgress) {
    runLog(`건너뜀: 같은 서버에서 다른 실행이 진행 중입니다 (${state.lastRunStartedAt} 시작).`);
    return null;
  }

  let cooldown: BotBlockCooldown | null = null;
  try {
    cooldown = await getBotBlockCooldown();
  } catch {
    // DB hiccup: the target query below fails the same way and is handled there.
  }
  const phase = cooldownPhase(cooldown);
  if (phase === "waiting") {
    if (!options.quietWhenIdle) {
      runLog(`건너뜀: 올리브영 차단으로 ${formatClock(cooldown!.until)}까지 요청을 멈춘 상태입니다 (${cooldown!.level}단계).`);
    }
    return null;
  }

  state.cycleInProgress = true;
  const startedAt = new Date();
  state.lastRunStartedAt = startedAt.toISOString();

  try {
    // After a block's wait: one product only, to see whether it has lifted.
    const probing = phase === "probing";
    const targets = await listDueTrackedProducts(startedAt.toISOString(), probing ? 1 : MAX_PRODUCTS_PER_TICK);
    if (targets.length === 0 && options.quietWhenIdle) return null;
    if (probing) runLog(`차단 대기가 끝났습니다 (${cooldown!.level}단계). 상품 1개로 차단이 풀렸는지 확인합니다.`);
    const cutoffNote =
      options.stopStartingAt != null
        ? ` · 새 상품 시작 마감 ${seconds(options.stopStartingAt - startedAt.getTime())} 후`
        : "";
    // On Vercel, serverless Chromium renders one page at a time anyway (see
    // createServerlessRenderSession), so a second worker would only sit in
    // the browser's queue while its log line already says "started", and the
    // start cutoff would be checked too early for it.
    const concurrency = process.env.VERCEL ? 1 : state.concurrency;
    const concurrencyNote = concurrency === state.concurrency ? `${concurrency}개` : `${concurrency}개 (Vercel 브라우저 제약, 설정값 ${state.concurrency})`;
    runLog(`===== 수집 시작 · 대상 ${targets.length}개 · 동시 처리 ${concurrencyNote}${cutoffNote} =====`);
    runLog(`환경: ${process.env.VERCEL ? `Vercel(${process.env.VERCEL_REGION ?? "region 미상"})` : "로컬"} · ${resourceSnapshot()}`);
    if (targets.length > 0) runLog(`대상 목록: ${targets.map((t) => t.id).join(", ")}`);
    if (targets.length === MAX_PRODUCTS_PER_TICK) {
      runLog(`처리 상한(${MAX_PRODUCTS_PER_TICK}개)에 도달했습니다. 남은 상품은 다음 실행에서 오래 기다린 순서대로 처리합니다.`);
    }
    const total = targets.length;

    let botBlockedCount = 0;
    let circuitBroken = false;
    let outOfTime = false;
    const results = await withRenderSession(() =>
      mapWithConcurrency(targets, concurrency, (p) => collectOne(p, `(${targets.indexOf(p) + 1}/${total})`, collector), {
      onResult: (r) => {
        if (r.status === "BOT_BLOCKED") {
          botBlockedCount += 1;
          if (probing || botBlockedCount >= BOT_BLOCK_CIRCUIT_BREAKER_THRESHOLD) circuitBroken = true;
        }
      },
      shouldAbort: () => {
        if (circuitBroken) return true;
        if (options.stopStartingAt != null && Date.now() >= options.stopStartingAt) {
          outOfTime = true;
          return true;
        }
        return false;
      },
      })
    );

    const processed = results.filter((r): r is SchedulerRunResult => r !== undefined);

    if (outOfTime && !circuitBroken) {
      // Left untouched on purpose: still due, oldest first, so the next run
      // picks them up before anything else.
      // Not results.filter(...): the results array has holes for never-started
      // items, and filter skips holes, which made this always report 0.
      const remaining = total - processed.length;
      runWarn(`시간 한도에 가까워 새 상품 시작을 멈췄습니다. 남은 ${remaining}개는 다음 실행에서 처리합니다.`);
    }

    if (circuitBroken) {
      // Products not reached stay due; the pause keeps every request away
      // until it ends, then a single probe decides.
      const next = await startBotBlockCooldown();
      const waitMin = Math.round((new Date(next.until).getTime() - Date.now()) / 60_000);
      runWarn(
        probing
          ? `아직 차단 중입니다. ${waitMin}분 더 기다렸다가 ${formatClock(next.until)}에 다시 확인합니다 (${next.level}단계).`
          : `올리브영 차단 ${botBlockedCount}건 감지로 중단합니다. ${waitMin}분 동안 요청을 멈추고 ${formatClock(next.until)}에 상품 1개로 다시 확인합니다. 남은 ${total - processed.length}개는 그대로 대기합니다.`
      );
    } else if (probing && processed.length > 0) {
      await clearBotBlockCooldown();
      runLog("차단이 풀렸습니다. 다음 확인부터 정상적으로 수집합니다.");
    }

    state.lastRunResults = processed;
    const ok = processed.filter((r) => r.status === "SUCCESS").length;
    const drops = processed.filter((r) => r.changeType === "decrease").length;
    const causes = new Map<string, number>();
    for (const r of processed) {
      if (r.status === "SUCCESS") continue;
      const cause = collectFailureCategory(r.status, r.error);
      causes.set(cause, (causes.get(cause) ?? 0) + 1);
    }
    const causeNote =
      causes.size > 0
        ? ` · 실패 원인: ${[...causes.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}`
        : "";
    const summary = `===== 수집 종료 · ${seconds(Date.now() - startedAt.getTime())} · 대상 ${total} · 성공 ${ok} · 실패 ${processed.length - ok} · 미처리 ${total - processed.length} · 가격 하락 ${drops}${causeNote} =====`;
    if (ok === processed.length) runLog(summary);
    else runWarn(summary);
    return {
      startedAt: startedAt.toISOString(),
      finishedAt: new Date().toISOString(),
      total,
      succeeded: ok,
      failed: processed.length - ok,
      botBlocked: processed.filter((r) => r.status === "BOT_BLOCKED").length,
      skipped: total - processed.length,
      priceDrops: drops,
    };
  } catch (err) {
    // listDueTrackedProducts itself failing (DB unreachable before we even
    // got a product list) — the whole tick is a no-op, but the process and
    // the timer must survive; the next tick tries again on its own.
    // recordError also prints to the console; when the DB itself is down it
    // can't save the row, and the console line is all that remains.
    runWarn(
      `===== 수집 비정상 종료 · ${seconds(Date.now() - startedAt.getTime())} · ${err instanceof Error ? err.message.split("\n")[0] : String(err)} =====`
    );
    await recordError({
      source: err instanceof DbConnectionError || err instanceof DbConfigError ? "scheduler:db" : "scheduler:cycle",
      error: err,
    });
    return null;
  } finally {
    state.cycleInProgress = false;
    const finishedAt = new Date();
    state.lastRunFinishedAt = finishedAt.toISOString();
    state.lastRunDurationMs = finishedAt.getTime() - startedAt.getTime();
  }
}

export async function getSchedulerStatus(): Promise<SchedulerStatus> {
  const state = await ensureSettingsLoaded();
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    concurrency: state.concurrency,
    cycleInProgress: state.cycleInProgress,
    lastRunStartedAt: state.lastRunStartedAt,
    lastRunFinishedAt: state.lastRunFinishedAt,
    lastRunDurationMs: state.lastRunDurationMs,
    lastRunResults: state.lastRunResults,
  };
}

export interface SchedulerConfigInput {
  intervalMs?: number;
  enabled?: boolean;
  concurrency?: number;
}

/** Admin-facing config update — validates, applies in-memory, and persists to app_settings. */
export async function updateSchedulerConfig(input: SchedulerConfigInput): Promise<{ error?: string }> {
  const state = await ensureSettingsLoaded(); // so a field NOT in `input` keeps its real persisted value, not a fresh process's default

  if (input.intervalMs != null) {
    if (!Number.isFinite(input.intervalMs) || input.intervalMs < MIN_INTERVAL_MS) {
      return { error: `주기는 최소 ${MIN_INTERVAL_MS / 60000}분 이상이어야 합니다 (대상 서버 부담 방지).` };
    }
    state.intervalMs = input.intervalMs;
  }

  if (input.concurrency != null) {
    if (!Number.isInteger(input.concurrency) || input.concurrency < 1 || input.concurrency > MAX_CONCURRENCY) {
      return { error: `동시 처리 개수는 1~${MAX_CONCURRENCY} 사이여야 합니다.` };
    }
    state.concurrency = input.concurrency;
  }

  if (input.enabled != null) {
    state.enabled = input.enabled;
  }

  try {
    if (input.intervalMs != null) await persistIntervalMs(input.intervalMs);
    if (input.concurrency != null) await persistConcurrency(input.concurrency);
    if (input.enabled != null) await persistEnabled(input.enabled);
  } catch (err) {
    console.error("[price-scheduler] 설정 저장 실패 (이번 프로세스에는 적용됐지만 재시작 시 사라질 수 있음):", err);
    return { error: "설정이 적용됐지만 저장에는 실패했습니다. 서버 재시작 시 초기화될 수 있습니다." };
  }

  return {};
}

/**
 * Manually trigger a cycle right now (admin "지금 바로 실행"). Still won't
 * overlap an already-running cycle. Fire-and-forget on purpose — a cycle can
 * take tens of seconds and the admin shouldn't have to wait for the button
 * click to resolve — but run via runAfterResponse so it's actually
 * guaranteed to finish (Vercel's `waitUntil`) rather than possibly getting
 * cut off the moment the Server Action's response goes out.
 */
export function runSchedulerNow(): void {
  // after() runs under the page's own time limit (300s default with Fluid
  // compute), so the same cutoff as the cron route applies.
  const stopStartingAt = Date.now() + 300_000 - CYCLE_START_CUTOFF_MARGIN_MS;
  runAfterResponse(async () => {
    try {
      await runOneCycle(undefined, { stopStartingAt });
    } catch (err) {
      await recordError({ source: "scheduler:manual-run", error: err });
    }
  });
}
