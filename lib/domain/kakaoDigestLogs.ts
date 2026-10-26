import { getDb } from "@/lib/db/client";
import type { KakaoDigestLogRow } from "@/lib/db/rows";

/**
 * Visibility + idempotency for the daily "N개 상품 가격이 내려갔어요" Kakao
 * digest (lib/digestScheduler.ts) — same spirit as kakao_send_logs, but keyed
 * by (user, calendar day) instead of (user, product), since a digest summarizes
 * many products at once rather than being about one.
 */

export type KakaoDigestStatus = "sent" | "skipped" | "failed";

/** True only if today's digest for this user already succeeded — a prior 'failed'/'skipped' attempt must not block a later retry the same day. */
export async function hasSentDigestToday(userId: string, digestDate: string): Promise<boolean> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT 1 FROM kakao_digest_logs WHERE user_id = ? AND digest_date = ? AND status = 'sent'`)
    .get(userId, digestDate);
  return row !== undefined;
}

/**
 * Upsert on (user_id, digest_date): a retry later the same day (e.g. after an
 * earlier 'failed' attempt) overwrites the row instead of violating the
 * UNIQUE constraint, so there's still only ever one row per user per day.
 */
export async function recordDigestLog(input: {
  userId: string;
  digestDate: string;
  dropCount: number;
  status: KakaoDigestStatus;
  detail?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO kakao_digest_logs (user_id, digest_date, drop_count, status, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, digest_date) DO UPDATE SET
         drop_count = excluded.drop_count,
         status = excluded.status,
         detail = excluded.detail,
         created_at = excluded.created_at`
    )
    .run(input.userId, input.digestDate, input.dropCount, input.status, input.detail ?? null, new Date().toISOString());
}

export interface AdminKakaoDigestLogRow {
  id: number;
  userId: string;
  userName: string;
  userEmail: string | null;
  digestDate: string;
  dropCount: number;
  status: KakaoDigestStatus;
  detail: string | null;
  createdAt: string;
}

/** Admin-wide, newest-first — mirrors listRecentKakaoSendLogs for the admin screen. */
export async function listRecentKakaoDigestLogs(limit = 100): Promise<AdminKakaoDigestLogRow[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT l.*, u.name AS user_name, u.email AS user_email
       FROM kakao_digest_logs l
       INNER JOIN users u ON u.id = l.user_id
       ORDER BY l.id DESC
       LIMIT ?`
    )
    .all(limit)) as unknown as (KakaoDigestLogRow & { user_name: string; user_email: string | null })[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    digestDate: row.digest_date,
    dropCount: row.drop_count,
    status: row.status as KakaoDigestStatus,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}
