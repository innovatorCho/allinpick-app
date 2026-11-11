"use server";

import { requireUser } from "@/lib/session";
import { deletePushSubscription, savePushSubscription } from "@/lib/domain/pushSubscriptions";
import { recordError } from "@/lib/domain/errorLogs";
import { getSiteSettings } from "@/lib/domain/siteSettings";
import { getBaseUrl } from "@/lib/auth/providers";
import { sendWebPushToUser } from "@/lib/webPush";

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function isValid(sub: PushSubscriptionInput): boolean {
  return (
    typeof sub?.endpoint === "string" &&
    sub.endpoint.startsWith("https://") &&
    sub.endpoint.length <= 1000 &&
    typeof sub.keys?.p256dh === "string" &&
    typeof sub.keys?.auth === "string" &&
    sub.keys.p256dh.length <= 200 &&
    sub.keys.auth.length <= 100
  );
}

/** Saves this browser's subscription, then sends a confirmation alert so the user sees it works. */
export async function subscribePushAction(sub: PushSubscriptionInput, userAgent: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!isValid(sub)) return { error: "알림 정보를 확인하지 못했어요. 다시 시도해주세요." };
  try {
    await savePushSubscription({
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent: userAgent.slice(0, 300),
    });
    const site = await getSiteSettings();
    await sendWebPushToUser(user.id, {
      title: site.serviceName ?? "",
      body: site.pushWelcomeMessage ?? "",
      url: `${getBaseUrl()}/my`,
      tag: "push-welcome",
    });
    return {};
  } catch (err) {
    await recordError({ source: "push:subscribe", error: err, userId: user.id });
    return { error: "알림을 켜지 못했어요. 잠시 후 다시 시도해주세요." };
  }
}

export async function unsubscribePushAction(endpoint: string): Promise<void> {
  const user = await requireUser();
  if (typeof endpoint !== "string") return;
  await deletePushSubscription(user.id, endpoint);
}
