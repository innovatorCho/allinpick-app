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

const KEYS = {
  intervalMs: "scheduler_interval_ms",
  enabled: "scheduler_enabled",
  concurrency: "scheduler_concurrency",
} as const;

export interface SchedulerSettings {
  intervalMs: number;
  enabled: boolean;
  concurrency: number;
}

export async function loadSchedulerSettings(): Promise<SchedulerSettings> {
  const [persistedEnabled, persistedConcurrency, intervalMs] = await Promise.all([
    getSetting(KEYS.enabled),
    getSetting(KEYS.concurrency),
    getConfiguredIntervalMs(),
  ]);

  return {
    intervalMs,
    enabled: persistedEnabled != null ? persistedEnabled === "true" : true,
    concurrency: persistedConcurrency ? Number(persistedConcurrency) : DEFAULT_CONCURRENCY,
  };
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
