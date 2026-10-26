import { getDb } from "@/lib/db/client";
import type { UserTrackingRow } from "@/lib/db/rows";
import type { UserTracking } from "./types";

function toTracking(row: UserTrackingRow): UserTracking {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    targetPrice: row.target_price,
    createdAt: row.created_at,
  };
}

export async function getTracking(userId: string, productId: string): Promise<UserTracking | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT * FROM user_tracking WHERE user_id = ? AND product_id = ?`)
    .get(userId, productId)) as UserTrackingRow | undefined;
  return row ? toTracking(row) : null;
}

/** Adds a tracking relationship if one doesn't already exist (idempotent — AGENTS.md TEST2). */
export async function trackProduct(userId: string, productId: string): Promise<UserTracking> {
  const existing = await getTracking(userId, productId);
  if (existing) return existing;
  const db = await getDb();
  await db
    .prepare(`INSERT INTO user_tracking (user_id, product_id, target_price, created_at) VALUES (?, ?, NULL, ?)`)
    .run(userId, productId, new Date().toISOString());
  return (await getTracking(userId, productId))!;
}

export async function untrackProduct(userId: string, productId: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`DELETE FROM user_tracking WHERE user_id = ? AND product_id = ?`)
    .run(userId, productId);
}

export async function setTargetPrice(userId: string, productId: string, targetPrice: number | null): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE user_tracking SET target_price = ? WHERE user_id = ? AND product_id = ?`)
    .run(targetPrice, userId, productId);
}

export async function listTrackersForProduct(productId: string): Promise<UserTracking[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM user_tracking WHERE product_id = ?`)
    .all(productId)) as unknown as UserTrackingRow[];
  return rows.map(toTracking);
}

export async function listTrackingForUser(userId: string): Promise<UserTracking[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM user_tracking WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId)) as unknown as UserTrackingRow[];
  return rows.map(toTracking);
}
