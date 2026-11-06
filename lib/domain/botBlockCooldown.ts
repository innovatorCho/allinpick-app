import { deleteSetting, getSetting, setSetting } from "./settings";

/**
 * Pause on all OliveYoung requests after its bot check blocks us.
 *
 * A block applies to the whole connection (IP), not to the product that
 * happened to hit it, and it lasts tens of minutes. Retrying other products
 * meanwhile only gets them blocked too and likely keeps the block going.
 * So the scheduler (lib/priceScheduler.ts) stops requesting entirely, waits,
 * then tries a single product to see whether the block has lifted:
 *  - lifted   → the pause is cleared and collection resumes normally;
 *  - still on → the next, longer wait step starts.
 *
 * Kept in the DB, not in memory, so it survives a worker restart and the
 * admin page on Vercel can show it.
 */

const KEY = "collect.botBlockCooldown";

/** Wait before the n-th consecutive check (minutes); the last step repeats. */
export const BOT_BLOCK_WAIT_STEPS_MIN = [30, 60, 120, 240, 360];

export interface BotBlockCooldown {
  /** 1 for the first block, +1 for each probe that was blocked again. */
  level: number;
  blockedAt: string;
  /** No requests until then; after it, one probe request decides. */
  until: string;
}

export type CooldownPhase = "none" | "waiting" | "probing";

export async function getBotBlockCooldown(): Promise<BotBlockCooldown | null> {
  const raw = await getSetting(KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BotBlockCooldown;
  } catch {
    return null;
  }
}

export function cooldownPhase(cooldown: BotBlockCooldown | null, now = Date.now()): CooldownPhase {
  if (!cooldown) return "none";
  return now < new Date(cooldown.until).getTime() ? "waiting" : "probing";
}

/** Starts the pause, or moves to the next longer step if one was already in progress. */
export async function startBotBlockCooldown(now = new Date()): Promise<BotBlockCooldown> {
  const previous = await getBotBlockCooldown();
  const level = (previous?.level ?? 0) + 1;
  const minutes = BOT_BLOCK_WAIT_STEPS_MIN[Math.min(level, BOT_BLOCK_WAIT_STEPS_MIN.length) - 1];
  const cooldown: BotBlockCooldown = {
    level,
    blockedAt: now.toISOString(),
    until: new Date(now.getTime() + minutes * 60_000).toISOString(),
  };
  await setSetting(KEY, JSON.stringify(cooldown));
  return cooldown;
}

/** The block has lifted: back to normal collection, and the next block starts again from the first step. */
export async function clearBotBlockCooldown(): Promise<void> {
  await deleteSetting(KEY);
}

/** Admin "지금 확인": ends the wait so the next run sends the single probe request right away. */
export async function endBotBlockWaitNow(now = new Date()): Promise<void> {
  const cooldown = await getBotBlockCooldown();
  if (!cooldown) return;
  await setSetting(KEY, JSON.stringify({ ...cooldown, until: now.toISOString() }));
}
