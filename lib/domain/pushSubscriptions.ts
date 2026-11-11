import { getDb } from "@/lib/db/client";
import type { PushSubscriptionRow } from "@/lib/db/rows";

/** Browser push subscriptions (lib/webPush.ts), one per browser/device a user turned alerts on in. */

export interface PushSubscriptionRecord {
  id: number;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

function toRecord(row: PushSubscriptionRow): PushSubscriptionRecord {
  return { id: row.id, userId: row.user_id, endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
}

/**
 * Saves a subscription for `userId`. The same browser subscribing again (or
 * after another account logged in on it) keeps one row, now owned by `userId`.
 */
export async function savePushSubscription(input: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh,
         auth = excluded.auth, user_agent = excluded.user_agent`
    )
    .run(input.userId, input.endpoint, input.p256dh, input.auth, input.userAgent ?? null, new Date().toISOString());
}

/** Scoped to `userId` so one user can never remove another user's subscription. */
export async function deletePushSubscription(userId: string, endpoint: string): Promise<void> {
  const db = await getDb();
  await db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?`).run(userId, endpoint);
}

/** For subscriptions the push service reports as gone (expired, or the user revoked permission). */
export async function deletePushSubscriptionById(id: number): Promise<void> {
  const db = await getDb();
  await db.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).run(id);
}

export async function listPushSubscriptionsForUser(userId: string): Promise<PushSubscriptionRecord[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY id`)
    .all(userId)) as unknown as PushSubscriptionRow[];
  return rows.map(toRecord);
}

export async function markPushSent(ids: number[], at = new Date()): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db
    .prepare(`UPDATE push_subscriptions SET last_sent_at = ? WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .run(at.toISOString(), ...ids);
}

export async function getLastPushSentAt(userId: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT MAX(last_sent_at) AS last FROM push_subscriptions WHERE user_id = ?`)
    .get(userId)) as { last: string | null } | undefined;
  return row?.last ?? null;
}
