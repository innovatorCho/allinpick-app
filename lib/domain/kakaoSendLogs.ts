import { getDb } from "@/lib/db/client";
import type { KakaoSendLogRow } from "@/lib/db/rows";
import type { NotificationType } from "./types";

/**
 * Visibility for lib/kakaoMessaging.ts's fire-and-forget sends — without this,
 * success/failure only ever showed up in the server console, invisible during
 * unattended/automatic operation (the whole point of this app's scheduler).
 */

export type KakaoSendStatus = "sent" | "skipped" | "failed";

export async function recordKakaoSendLog(input: {
  userId: string;
  productId: string;
  type: NotificationType;
  status: KakaoSendStatus;
  /** Error message for "failed", a short reason for "skipped" (e.g. no linked account); null for "sent". */
  detail?: string | null;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO kakao_send_logs (user_id, product_id, notification_type, status, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(input.userId, input.productId, input.type, input.status, input.detail ?? null, new Date().toISOString());
}

export interface AdminKakaoSendLogRow {
  id: number;
  userId: string;
  userName: string;
  userEmail: string | null;
  productId: string;
  productName: string;
  type: NotificationType;
  status: KakaoSendStatus;
  detail: string | null;
  createdAt: string;
}

/** Admin-wide, newest-first — for the "최근 카카오톡 발송 이력" admin screen. */
export async function listRecentKakaoSendLogs(limit = 100): Promise<AdminKakaoSendLogRow[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      // Ordered by `id`, not `created_at` — these are fire-and-forget writes
      // from concurrent background sends, so two can legitimately share the
      // same millisecond timestamp, and ORDER BY created_at alone would then
      // tie-break arbitrarily. The autoincrement id always reflects true
      // insertion order.
      `SELECT l.*, u.name AS user_name, u.email AS user_email, p.name AS product_name
       FROM kakao_send_logs l
       INNER JOIN users u ON u.id = l.user_id
       INNER JOIN products p ON p.oliveyoung_product_id = l.product_id
       ORDER BY l.id DESC
       LIMIT ?`
    )
    .all(limit)) as unknown as (KakaoSendLogRow & { user_name: string; user_email: string | null; product_name: string })[];

  return rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    productId: row.product_id,
    productName: row.product_name,
    type: row.notification_type as NotificationType,
    status: row.status as KakaoSendStatus,
    detail: row.detail,
    createdAt: row.created_at,
  }));
}

/** When `userId` last actually received a Kakao alert — the batching window (lib/kakaoBatch.ts) counts from here. */
export async function getLastKakaoSentAt(userId: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT MAX(created_at) AS last FROM kakao_send_logs WHERE user_id = ? AND status = 'sent'`)
    .get(userId)) as { last: string | null } | undefined;
  return row?.last ?? null;
}
