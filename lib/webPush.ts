import webpush from "web-push";
import {
  deletePushSubscriptionById,
  listPushSubscriptionsForUser,
  markPushSent,
} from "@/lib/domain/pushSubscriptions";
import { recordError } from "@/lib/domain/errorLogs";
import { getBaseUrl } from "@/lib/auth/providers";
import { truncateProductName } from "@/lib/domain/kakaoTemplates";
import { renderNotificationContent, type KakaoNotifyInput } from "@/lib/kakaoMessaging";
import { runAfterResponse } from "@/lib/runAfterResponse";

/**
 * Browser push alerts (Web Push), shown as "올인픽" with the site icon,
 * unlike Kakao "나에게 보내기", which always comes from the user's own
 * account. Works for Google-login users too. Sent alongside Kakao from the
 * same places (lib/kakaoBatch.ts, lib/domain/notifications.ts) with the
 * same admin templates. The browser side is public/sw.js and
 * components/PushSubscribeButton.tsx.
 *
 * Needs VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY (generate once with
 * `npx web-push generate-vapid-keys`; the same pair on Vercel and the
 * collector worker). Without them push is off and every call is a no-op.
 * Never throws.
 */

export interface WebPushMessage {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  image?: string | null;
  /** A newer alert with the same tag replaces the older one on the device. */
  tag?: string;
}

export function getVapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function configure(): boolean {
  const publicKey = getVapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  // The push service contacts this address about problems; the site URL is accepted in place of an email.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT?.trim() || getBaseUrl(), publicKey, privateKey);
  return true;
}

/** Sends to every browser `userId` turned alerts on in. Returns how many accepted it. Never throws. */
export async function sendWebPushToUser(userId: string, message: WebPushMessage): Promise<number> {
  try {
    if (!configure()) return 0;
    const subscriptions = await listPushSubscriptionsForUser(userId);
    if (subscriptions.length === 0) return 0;

    const payload = JSON.stringify({
      ...message,
      icon: `${getBaseUrl()}/brand/icon-192.png`,
      badge: `${getBaseUrl()}/brand/badge-96.png`,
    });
    const delivered: number[] = [];
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, {
          TTL: 24 * 60 * 60,
        });
        delivered.push(sub.id);
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // Expired, or the user blocked notifications for the site: nothing will ever arrive there again.
          await deletePushSubscriptionById(sub.id);
        } else {
          await recordError({ source: "web-push:send", error: err, userId, context: { status } });
        }
      }
    }
    await markPushSent(delivered);
    return delivered.length;
  } catch (err) {
    await recordError({ source: "web-push", error: err, userId });
    return 0;
  }
}

/** One product's alert, worded by the admin template for its type, like the Kakao message. */
export async function sendProductWebPush(userId: string, input: KakaoNotifyInput): Promise<number> {
  try {
    const content = await renderNotificationContent(input);
    if (!content) return 0;
    return await sendWebPushToUser(userId, {
      title: truncateProductName(content.productName),
      body: content.text,
      url: content.productUrl,
      image: content.imageUrl,
      tag: `product-${input.productId}`,
    });
  } catch (err) {
    await recordError({ source: "web-push", error: err, userId });
    return 0;
  }
}

/** Fire-and-forget version for request handlers, kept alive past the response like the Kakao send. */
export function sendProductWebPushBestEffort(userId: string, input: KakaoNotifyInput): void {
  runAfterResponse(async () => {
    await sendProductWebPush(userId, input);
  });
}
