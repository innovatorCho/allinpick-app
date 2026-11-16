import { getSetting, setSetting } from "./settings";

/**
 * Persisted scheduler configuration — split out from lib/priceScheduler.ts
 * (which owns the actual timers) so lib/domain/collection.ts can read the
 * current base interval for per-product schedule calculations without
 * creating an import cycle (priceScheduler.ts already imports collection.ts).
 */

export const DEFAULT_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
export const MIN_INTERVAL_MS = 5 * 60 * 1000; // don't allow hammering the target more than this
export const DEFAULT_CONCURRENCY = 3;
export const MAX_CONCURRENCY = 5;

/**
 * Pacing for the collector worker, against OliveYoung's bot check: requests
 * one product at a time with a random pause in between (a burst of
 * back-to-back page loads is what got blocked), and during quiet hours only
 * products nobody has data for yet. Hours are Korean time.
 */
export const DEFAULT_REQUEST_GAP_MIN_SEC = 20;
export const DEFAULT_REQUEST_GAP_MAX_SEC = 60;
export const MAX_REQUEST_GAP_SEC = 600;
export const DEFAULT_QUIET_START_HOUR = 2;
export const DEFAULT_QUIET_END_HOUR = 7;

const KEYS = {
  intervalMs: "scheduler_interval_ms",
  enabled: "scheduler_enabled",
  concurrency: "scheduler_concurrency",
  requestGapMinSec: "scheduler_request_gap_min_sec",
  requestGapMaxSec: "scheduler_request_gap_max_sec",
  quietStartHour: "scheduler_quiet_start_hour",
  quietEndHour: "scheduler_quiet_end_hour",
} as const;

export interface SchedulerSettings {
  intervalMs: number;
  enabled: boolean;
  concurrency: number;
  pacing: PacingSettings;
}

export interface PacingSettings {
  /** Random pause between two products, in seconds. 0/0 turns it off (and concurrency applies again). */
  requestGapMinSec: number;
  requestGapMaxSec: number;
  /** Korean-time hours [start, end) when only never-collected products are fetched. Equal means off. */
  quietStartHour: number;
  quietEndHour: number;
}

function numberOr(raw: string | null, fallback: number): number {
  const n = raw == null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export async function loadSchedulerSettings(): Promise<SchedulerSettings> {
  const [persistedEnabled, persistedConcurrency, intervalMs, gapMin, gapMax, quietStart, quietEnd] = await Promise.all([
    getSetting(KEYS.enabled),
    getSetting(KEYS.concurrency),
    getConfiguredIntervalMs(),
    getSetting(KEYS.requestGapMinSec),
    getSetting(KEYS.requestGapMaxSec),
    getSetting(KEYS.quietStartHour),
    getSetting(KEYS.quietEndHour),
  ]);

  return {
    intervalMs,
    enabled: persistedEnabled != null ? persistedEnabled === "true" : true,
    concurrency: persistedConcurrency ? Number(persistedConcurrency) : DEFAULT_CONCURRENCY,
    pacing: {
      requestGapMinSec: numberOr(gapMin, DEFAULT_REQUEST_GAP_MIN_SEC),
      requestGapMaxSec: numberOr(gapMax, DEFAULT_REQUEST_GAP_MAX_SEC),
      quietStartHour: numberOr(quietStart, DEFAULT_QUIET_START_HOUR),
      quietEndHour: numberOr(quietEnd, DEFAULT_QUIET_END_HOUR),
    },
  };
}

/** Rejects out-of-range values with a message for the admin form. */
export function validatePacing(p: PacingSettings): string | null {
  const ints = [p.requestGapMinSec, p.requestGapMaxSec, p.quietStartHour, p.quietEndHour];
  if (!ints.every(Number.isInteger)) return "요청 간격과 쉬는 시간은 정수로 입력해주세요.";
  if (p.requestGapMinSec < 0 || p.requestGapMaxSec > MAX_REQUEST_GAP_SEC || p.requestGapMinSec > p.requestGapMaxSec) {
    return `요청 간격은 0~${MAX_REQUEST_GAP_SEC}초, 최소가 최대보다 작거나 같아야 합니다.`;
  }
  if ([p.quietStartHour, p.quietEndHour].some((h) => h < 0 || h > 23)) return "쉬는 시간은 0~23시로 입력해주세요.";
  return null;
}

export async function persistPacing(p: PacingSettings): Promise<void> {
  await Promise.all([
    setSetting(KEYS.requestGapMinSec, String(p.requestGapMinSec)),
    setSetting(KEYS.requestGapMaxSec, String(p.requestGapMaxSec)),
    setSetting(KEYS.quietStartHour, String(p.quietStartHour)),
    setSetting(KEYS.quietEndHour, String(p.quietEndHour)),
  ]);
}

/** Whether `now` falls in the quiet hours (Korean time); the window may wrap past midnight (e.g. 23 → 6). */
export function isQuietHour(p: Pick<PacingSettings, "quietStartHour" | "quietEndHour">, now = new Date()): boolean {
  const { quietStartHour: start, quietEndHour: end } = p;
  if (start === end) return false;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(now));
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** Just the interval — the one value lib/domain/collection.ts needs for its own per-product scheduling math. */
export async function getConfiguredIntervalMs(): Promise<number> {
  const persisted = await getSetting(KEYS.intervalMs);
  if (persisted) return Number(persisted);
  return process.env.PRICE_RECHECK_INTERVAL_MS ? Number(process.env.PRICE_RECHECK_INTERVAL_MS) : DEFAULT_INTERVAL_MS;
}

export async function persistIntervalMs(value: number): Promise<void> {
  await setSetting(KEYS.intervalMs, String(value));
}

export async function persistEnabled(value: boolean): Promise<void> {
  await setSetting(KEYS.enabled, String(value));
}

export async function persistConcurrency(value: number): Promise<void> {
  await setSetting(KEYS.concurrency, String(value));
}
