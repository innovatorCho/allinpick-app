import { getSetting, setSetting } from "./settings";
import { canCollectHere } from "@/lib/collectMode";

/**
 * What the collector worker (scripts/worker.ts) last reported about itself,
 * so the admin schedule page on Vercel can show whether collection is
 * actually happening. The worker runs on someone's computer; without this,
 * a sleeping or closed laptop silently stops all price checks.
 *
 * Stored as one JSON value in app_settings, overwritten on every poll.
 */

const KEY = "worker.status";

/** The worker polls every 30s; no report for this long means it's not running. */
export const WORKER_OFFLINE_AFTER_MS = 3 * 60_000;

export interface CycleSummary {
  startedAt: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  failed: number;
  botBlocked: number;
  /** Not attempted this run (time limit or bot-block early stop); still due. */
  skipped: number;
  priceDrops: number;
}

/** A run in progress, counted as products finish. */
export interface CycleProgress {
  startedAt: string;
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  /** The single-product check after a bot-block wait. */
  probing: boolean;
}

export interface WorkerStatus {
  /** Computer name, to tell which machine is collecting. */
  host: string;
  startedAt: string;
  /** Refreshed every 30s, also while a long run is in progress. */
  lastPollAt: string;
  /** Set while a run is collecting products. */
  cycleStartedAt: string | null;
  /** Live counts of the run in progress; absent from reports by older workers. */
  progress?: CycleProgress | null;
  /** Set when the worker was stopped normally (Ctrl+C), as opposed to the machine going to sleep. */
  stoppedAt: string | null;
  /** Last cycle that actually had products to collect; idle polls don't replace it. */
  lastRun: CycleSummary | null;
}

export async function saveWorkerStatus(status: WorkerStatus): Promise<void> {
  await setSetting(KEY, JSON.stringify(status));
}

export async function getWorkerStatus(): Promise<WorkerStatus | null> {
  const raw = await getSetting(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkerStatus;
  } catch {
    return null;
  }
}

/**
 * Whether this web server should open OliveYoung itself (registration,
 * admin re-check, keyword search, local cron). Only where it can collect at
 * all, and never while the collector worker is online: requests from two
 * places at once doubled the load and got the connection blocked. If the
 * worker's state can't be read, assume it's online.
 */
export async function shouldCollectInline(): Promise<boolean> {
  if (!canCollectHere()) return false;
  try {
    return !isWorkerOnline(await getWorkerStatus());
  } catch {
    return false;
  }
}

export function isWorkerOnline(status: WorkerStatus | null, now = Date.now()): boolean {
  return (
    status != null && status.stoppedAt == null && now - new Date(status.lastPollAt).getTime() < WORKER_OFFLINE_AFTER_MS
  );
}
