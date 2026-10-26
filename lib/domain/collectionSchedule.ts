import type { PriceChangeType } from "./types";

/**
 * Pure calculation of "when should this specific product be checked again",
 * given a base interval (the scheduler's admin-configured tick — see
 * lib/priceScheduler.ts) and this product's own recent history. No
 * randomness, no obfuscation, no attempt to look like anything other than
 * what it is — this diversifies *which products get checked when*, not
 * *how a request looks* (see chat history: that other kind of "diversity"
 * was explicitly declined).
 *
 * Because the scheduler only checks for due work once per tick, a computed
 * interval shorter than the tick can't actually be achieved more often than
 * the tick itself — it just means "always due, check it every tick". Only
 * intervals *longer* than the tick (backoff, stable products) have a real
 * effect. Lower the tick (admin schedule page) if finer-grained checking of
 * popular/volatile products matters more than this MVP's default.
 */

export interface ScheduleInput {
  baseIntervalMs: number;
  trackerCount: number;
  /** null means this attempt failed (no price comparison was possible). */
  changeType: PriceChangeType | null;
  /** Failures immediately *before* this attempt (not counting this one). */
  priorConsecutiveFailures: number;
  /** "same" streak immediately *before* this attempt. */
  priorConsecutiveSameCount: number;
}

export interface ScheduleOutput {
  nextCheckAt: string;
  consecutiveFailures: number;
  consecutiveSameCount: number;
  appliedMultiplier: number;
}

const MIN_MULTIPLIER = 0.5;
const MAX_MULTIPLIER = 4;
const MAX_BACKOFF_STEPS = 5; // caps exponential backoff growth at 2^5 = 32x
const MAX_BACKOFF_MS = 24 * 60 * 60 * 1000; // never wait longer than a day even after repeated failures
const SAME_STREAK_STEP = 0.5; // each consecutive unchanged check nudges the interval out by this much
const MAX_SAME_STREAK_FOR_SCALING = 6; // beyond this, stop stretching further

export function computeNextSchedule(input: ScheduleInput, now: Date = new Date()): ScheduleOutput {
  const { baseIntervalMs, trackerCount, changeType, priorConsecutiveFailures, priorConsecutiveSameCount } = input;

  if (changeType === null) {
    // Collection failed — back off exponentially so a permanently-broken
    // product (see chat history: a made-up test id) doesn't get retried
    // every single tick forever.
    const consecutiveFailures = priorConsecutiveFailures + 1;
    const steps = Math.min(consecutiveFailures, MAX_BACKOFF_STEPS);
    const delayMs = Math.min(baseIntervalMs * 2 ** steps, MAX_BACKOFF_MS);
    return {
      nextCheckAt: new Date(now.getTime() + delayMs).toISOString(),
      consecutiveFailures,
      consecutiveSameCount: priorConsecutiveSameCount, // unaffected by a failed attempt
      appliedMultiplier: delayMs / baseIntervalMs,
    };
  }

  // A successful attempt always resets the failure streak.
  let multiplier = 1;
  let consecutiveSameCount = priorConsecutiveSameCount;

  // Popularity: more people watching this product = worth checking sooner
  // (only matters when the tick itself is frequent enough to observe it —
  // see module doc comment).
  if (trackerCount >= 10) multiplier *= 0.5;
  else if (trackerCount >= 3) multiplier *= 0.75;

  if (changeType === "increase" || changeType === "decrease") {
    // Actively moving — worth checking again sooner. Reset the "stable" streak.
    multiplier *= 0.5;
    consecutiveSameCount = 0;
  } else if (changeType === "same") {
    consecutiveSameCount += 1;
    const easedSteps = Math.min(consecutiveSameCount, MAX_SAME_STREAK_FOR_SCALING);
    multiplier *= 1 + easedSteps * SAME_STREAK_STEP;
  } else {
    // 'initial' — first-ever successful collection, no history to react to yet.
    consecutiveSameCount = 0;
  }

  multiplier = Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, multiplier));
  const delayMs = Math.round(baseIntervalMs * multiplier);

  return {
    nextCheckAt: new Date(now.getTime() + delayMs).toISOString(),
    consecutiveFailures: 0,
    consecutiveSameCount,
    appliedMultiplier: multiplier,
  };
}
