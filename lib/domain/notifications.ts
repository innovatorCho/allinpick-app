import { getDb } from "@/lib/db/client";
import type { NotificationRow } from "@/lib/db/rows";
import { sendKakaoNotificationBestEffort } from "@/lib/kakaoMessaging";
import { sendProductWebPushBestEffort } from "@/lib/webPush";
import type { AppNotification, NotificationType } from "./types";

function toNotification(row: NotificationRow): AppNotification {
  return {
    id: row.id,
    userId: row.user_id,
    productId: row.product_id,
    type: row.type as NotificationType,
    message: row.message,
    oldPrice: row.old_price,
    newPrice: row.new_price,
    isRead: row.is_read === 1,
    createdAt: row.created_at,
  };
}

export async function createNotification(input: {
  userId: string;
  productId: string;
  type: NotificationType;
  message: string;
  oldPrice: number | null;
  newPrice: number | null;
  /** Only meaningful for type "target_price" — used to render the KakaoTalk template's {targetPrice}, not stored in-app. */
  targetPrice?: number | null;
  /**
   * Also attempt a KakaoTalk "나에게 보내기" send for this notification
   * (best-effort, fire-and-forget, using the admin-configured template for
   * this type — see lib/kakaoMessaging.ts / lib/domain/kakaoTemplates.ts).
   * Defaults to false so the admin test tool can exercise the in-app
   * pipeline alone without also spamming a real KakaoTalk message every time.
   * Also covers browser push (lib/webPush.ts), sent the same way.
   */
  sendKakao?: boolean;
  /**
   * With `sendKakao`: don't send now, queue it for the user's next batched
   * Kakao message (lib/kakaoBatch.ts), so a run that finds many price drops
   * becomes one summary instead of one message per product.
   */
  batchKakao?: boolean;
}): Promise<void> {
  const queue = input.sendKakao === true && input.batchKakao === true;
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO notifications (user_id, product_id, type, message, old_price, new_price, target_price, is_read, kakao_pending, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      input.userId,
      input.productId,
      input.type,
      input.message,
      input.oldPrice,
      input.newPrice,
      input.targetPrice ?? null,
      queue ? 1 : 0,
      new Date().toISOString()
    );
  if (queue) return;

  // The in-app notification row above is already committed — this can never
  // roll it back or delay the caller, it just best-effort mirrors it to Kakao
  // (using its own admin-configured template, not `input.message`). Not
  // awaited on purpose — fire-and-forget, same as before the DB migration.
  if (input.sendKakao) {
    const alert = {
      type: input.type,
      productId: input.productId,
      oldPrice: input.oldPrice,
      newPrice: input.newPrice,
      targetPrice: input.targetPrice,
    };
    sendKakaoNotificationBestEffort(input.userId, alert);
    sendProductWebPushBestEffort(input.userId, alert);
  }
}

export interface PendingKakaoNotification {
  id: number;
  productId: string;
  type: NotificationType;
  oldPrice: number | null;
  newPrice: number | null;
  targetPrice: number | null;
  createdAt: string;
}

/** Users with notifications waiting for their next batched Kakao message (lib/kakaoBatch.ts). */
export async function listUsersWithPendingKakao(): Promise<string[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT DISTINCT user_id FROM notifications WHERE kakao_pending = 1`)
    .all()) as unknown as { user_id: string }[];
  return rows.map((r) => r.user_id);
}

export async function listPendingKakaoForUser(userId: string): Promise<PendingKakaoNotification[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? AND kakao_pending = 1 ORDER BY id`)
    .all(userId)) as unknown as NotificationRow[];
  return rows.map((r) => ({
    id: r.id,
    productId: r.product_id,
    type: r.type as NotificationType,
    oldPrice: r.old_price,
    newPrice: r.new_price,
    targetPrice: r.target_price,
    createdAt: r.created_at,
  }));
}

/** Marks queued notifications as handled, whether the Kakao send succeeded or not (the send log keeps the outcome). */
export async function clearKakaoPending(ids: number[]): Promise<void> {
  if (ids.length === 0) return;
  const db = await getDb();
  await db
    .prepare(`UPDATE notifications SET kakao_pending = 0 WHERE id IN (${ids.map(() => "?").join(", ")})`)
    .run(...ids);
}

export async function listNotificationsForUser(userId: string): Promise<AppNotification[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId)) as unknown as NotificationRow[];
  return rows.map(toNotification);
}

export interface UserPriceDropCount {
  userId: string;
  count: number;
}

/**
 * Per-user count of price_drop notifications created at/after `sinceIso` —
 * feeds the daily Kakao digest (lib/digestScheduler.ts): "오늘 {count}개 상품
 * 가격이 내려갔어요". Reuses the existing in-app notifications a price drop
 * already creates (lib/domain/collection.ts's notifyPriceDrop) rather than
 * tracking drops separately — every price_drop notification row IS a drop
 * event, so counting them is exact, not an approximation.
 */
export async function listUsersWithPriceDropCountToday(sinceIso: string): Promise<UserPriceDropCount[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT user_id, COUNT(*) AS cnt FROM notifications
       WHERE type = 'price_drop' AND created_at >= ?
       GROUP BY user_id`
    )
    .all(sinceIso)) as unknown as { user_id: string; cnt: number }[];
  return rows.map((row) => ({ userId: row.user_id, count: row.cnt }));
}

export async function countUnread(userId: string): Promise<number> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT COUNT(*) AS cnt FROM notifications WHERE user_id = ? AND is_read = 0`)
    .get(userId)) as { cnt: number };
  return row.cnt;
}

export async function markAllRead(userId: string): Promise<void> {
  const db = await getDb();
  await db.prepare(`UPDATE notifications SET is_read = 1 WHERE user_id = ?`).run(userId);
}

/** Scoped to `userId` so one user can never mark another user's notification as read. */
export async function markNotificationRead(notificationId: number, userId: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?`)
    .run(notificationId, userId);
}

export interface AdminNotificationRow extends AppNotification {
  userName: string;
  userEmail: string | null;
  productName: string;
}

/** Admin-wide view across every user — for the notification management/test screen. */
export async function listAllNotificationsForAdmin(limit = 100): Promise<AdminNotificationRow[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT n.*, u.name AS user_name, u.email AS user_email, p.name AS product_name
       FROM notifications n
       INNER JOIN users u ON u.id = n.user_id
       INNER JOIN products p ON p.oliveyoung_product_id = n.product_id
       ORDER BY n.created_at DESC
       LIMIT ?`
    )
    .all(limit)) as unknown as (NotificationRow & { user_name: string; user_email: string | null; product_name: string })[];

  return rows.map((row) => ({
    ...toNotification(row),
    userName: row.user_name,
    userEmail: row.user_email,
    productName: row.product_name,
  }));
}
