import { listUsersWithPriceDropCountToday } from "@/lib/domain/notifications";
import { hasSentDigestToday } from "@/lib/domain/kakaoDigestLogs";
import { sendKakaoDigest } from "@/lib/kakaoMessaging";
import { DbConnectionError, DbConfigError } from "@/lib/db/client";

/**
 * Daily "오늘 N개 상품 가격이 내려갔어요" KakaoTalk digest — a deliberate
 * addition alongside the existing per-drop instant notification
 * (lib/domain/collection.ts's notifyPriceDrop), not a replacement for it:
 * both are sent to every user globally (see chat history design decision —
 * no per-user/admin on-off toggle for now).
 *
 * `runDigestCheck()` is idempotent and cheap to call repeatedly — it only
 * actually sends once the Asia/Seoul wall-clock digest window has opened
 * AND a user hasn't already gotten today's digest (lib/domain/kakaoDigestLogs.ts's
 * (user, date) UNIQUE constraint backs that up at the DB level too). *When*
 * it's called isn't this module's job — see app/api/cron/digest/route.ts,
 * triggered by Vercel Cron, an external pinger, or (locally)
 * instrumentation.ts's self-ping, same split as lib/priceScheduler.ts and for
 * the same reason (no long-running process to self-schedule a `setInterval`
 * on Vercel's serverless functions).
 *
 * The digest window is a fixed Asia/Seoul wall-clock hour, not "N hours after
 * boot" — a daily summary should mean the same time every day regardless of
 * when/how often it happens to get checked.
 */

const DIGEST_HOUR_KST = 21; // 21:00 (9pm) Asia/Seoul — a reasonable end-of-day summary time

/** Asia/Seoul has no DST — a fixed +09:00 offset always applies, so this never needs a timezone library. */
function getKstDateKeyAndHour(now: Date): { dateKey: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const dateKey = `${get("year")}-${get("month")}-${get("day")}`;
  // Intl can format midnight as "24" instead of "00" depending on runtime — normalize.
  const hour = Number(get("hour")) % 24;
  return { dateKey, hour };
}

/** Called by app/api/cron/digest/route.ts — see module doc comment for who triggers that and when. */
export async function runDigestCheck(): Promise<void> {
  const now = new Date();
  const { dateKey, hour } = getKstDateKeyAndHour(now);
  if (hour < DIGEST_HOUR_KST) return; // today's window hasn't opened yet — try again on the next call

  const startOfDayIso = new Date(`${dateKey}T00:00:00+09:00`).toISOString();

  let users;
  try {
    users = await listUsersWithPriceDropCountToday(startOfDayIso);
  } catch (err) {
    if (err instanceof DbConnectionError || err instanceof DbConfigError) {
      console.error("[digest-scheduler] DB 연결 실패로 이번 체크를 건너뜁니다:", err.message);
    } else {
      console.error("[digest-scheduler] 체크 중 예상치 못한 오류:", err);
    }
    return;
  }

  for (const { userId, count } of users) {
    if (count <= 0) continue;
    try {
      if (await hasSentDigestToday(userId, dateKey)) continue;
      await sendKakaoDigest(userId, dateKey, count);
    } catch (err) {
      // One user's failure (DB hiccup checking/recording, or the send itself
      // throwing past sendKakaoDigest's own try/catch somehow) must never
      // stop the rest of today's digests from going out.
      console.error(`[digest-scheduler] user ${userId} 처리 중 오류:`, err instanceof Error ? err.message : err);
    }
  }
}

// Exported for scripts/verify/test-digest.ts — pure function, no DB/network.
export const __testing = { getKstDateKeyAndHour, DIGEST_HOUR_KST };
