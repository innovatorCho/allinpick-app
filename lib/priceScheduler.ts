import { listDueTrackedProducts, getProductById, updateSchedulingMeta } from "@/lib/domain/products";
import { recordError } from "@/lib/domain/errorLogs";
import { recollectProduct, type Collector } from "@/lib/domain/collection";
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
 * Once this many BOT_BLOCKED results land in one tick, the rest of that
 * tick's queue is abandoned — those products are explicitly pushed out by
 * BOT_BLOCK_COOLDOWN_MS (not just left alone) so the very next tick doesn't
 * immediately retry into the same still-active block. If the block has
 * cleared by then, they just get picked up normally on schedule.
 */
const BOT_BLOCK_CIRCUIT_BREAKER_THRESHOLD = 2;
const BOT_BLOCK_COOLDOWN_MS = 20 * 60_000;

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

async function collectOne(product: Product, collector?: Collector): Promise<SchedulerRunResult> {
  try {
    const outcome = await recollectProduct(product.id, collector);
    const updated = await getProductById(product.id);
    return {
      productId: product.id,
      name: product.name,
      status: outcome.collectResult.status,
      changeType: outcome.changeType,
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
export async function runOneCycle(collector?: Collector): Promise<void> {
  const state = await ensureSettingsLoaded();

  if (!state.enabled) {
    console.log("[price-scheduler] 일시정지 상태라 이번 호출은 건너뜁니다.");
    return;
  }
  if (state.cycleInProgress) {
    console.log("[price-scheduler] 이전 재수집 주기가 아직 진행 중이라 이번 주기는 건너뜁니다.");
    return;
  }

  state.cycleInProgress = true;
  const startedAt = new Date();
  state.lastRunStartedAt = startedAt.toISOString();

  try {
    const targets = await listDueTrackedProducts(startedAt.toISOString(), MAX_PRODUCTS_PER_TICK);
    console.log(
      `[price-scheduler] 이번 틱에 확인이 필요한 상품 ${targets.length}개 재수집 시작 (동시 처리 ${state.concurrency}개)`
    );
    if (targets.length === MAX_PRODUCTS_PER_TICK) {
      console.log(
        `[price-scheduler] 처리 상한(${MAX_PRODUCTS_PER_TICK}개)에 도달했습니다 — 밀린 상품이 있다면 다음 틱들에 걸쳐 오래 기다린 순서대로 이어서 처리됩니다.`
      );
    }

    let botBlockedCount = 0;
    let circuitBroken = false;
    const results = await mapWithConcurrency(targets, state.concurrency, (p) => collectOne(p, collector), {
      onResult: (r) => {
        if (r.status === "BOT_BLOCKED") {
          botBlockedCount += 1;
          if (botBlockedCount >= BOT_BLOCK_CIRCUIT_BREAKER_THRESHOLD) circuitBroken = true;
        }
      },
      shouldAbort: () => circuitBroken,
    });

    const processed = results.filter((r): r is SchedulerRunResult => r !== undefined);
    for (const r of processed) {
      const changeNote = r.changeType ? ` (${r.changeType})` : "";
      const errNote = r.error ? ` — ${r.error}` : "";
      const nextNote = r.nextCheckAt ? `, 다음 확인: ${r.nextCheckAt}` : "";
      console.log(`[price-scheduler] ${r.productId} "${r.name}" → ${r.status}${changeNote}${errNote}${nextNote}`);
    }

    if (circuitBroken) {
      // targets[i] has no result → that worker never got to it before the
      // abort flag was checked. Push these out explicitly (not just "leave
      // alone") so the very next tick doesn't immediately retry into the
      // same still-active block — see BOT_BLOCK_COOLDOWN_MS's doc comment.
      const skipped = targets.filter((_, i) => results[i] === undefined);
      const cooldownUntil = new Date(Date.now() + BOT_BLOCK_COOLDOWN_MS).toISOString();
      for (const product of skipped) {
        await updateSchedulingMeta(product.id, {
          nextCheckAt: cooldownUntil,
          consecutiveFailures: product.consecutiveFailures, // unchanged — never actually attempted
          consecutiveSameCount: product.consecutiveSameCount,
        });
      }
      console.warn(
        `[price-scheduler] Cloudflare 차단 ${botBlockedCount}건 감지 — 이번 주기를 조기 중단합니다. 나머지 ${skipped.length}개 상품은 ${Math.round(BOT_BLOCK_COOLDOWN_MS / 60000)}분 뒤로 미룸.`
      );
    }

    state.lastRunResults = processed;
    console.log("[price-scheduler] 이번 주기 완료");
  } catch (err) {
    // listDueTrackedProducts itself failing (DB unreachable before we even
    // got a product list) — the whole tick is a no-op, but the process and
    // the timer must survive; the next tick tries again on its own.
    // recordError also prints to the console; when the DB itself is down it
    // can't save the row, and the console line is all that remains.
    await recordError({
      source: err instanceof DbConnectionError || err instanceof DbConfigError ? "scheduler:db" : "scheduler:cycle",
      error: err,
    });
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
  runAfterResponse(() => runOneCycle().catch((err) => recordError({ source: "scheduler:manual-run", error: err })));
}
