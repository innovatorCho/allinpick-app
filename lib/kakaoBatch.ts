import {
  clearKakaoPending,
  listPendingKakaoForUser,
  listUsersWithPendingKakao,
  type PendingKakaoNotification,
} from "@/lib/domain/notifications";
import { getLastKakaoSentAt } from "@/lib/domain/kakaoSendLogs";
import { getLastPushSentAt } from "@/lib/domain/pushSubscriptions";
import { getKakaoBatchSettings, renderSummaryTemplate } from "@/lib/domain/kakaoBatchSettings";
import { getProductById } from "@/lib/domain/products";
import { getPriceRange } from "@/lib/domain/priceHistory";
import { recordError } from "@/lib/domain/errorLogs";
import { sendKakaoNotification, sendKakaoSummary } from "@/lib/kakaoMessaging";
import { sendProductWebPush, sendWebPushToUser } from "@/lib/webPush";
import { runLog } from "@/lib/runLog";
import { getBaseUrl } from "@/lib/auth/providers";
import { truncateProductName } from "@/lib/domain/kakaoTemplates";
import { formatKrw } from "@/lib/format";

/**
 * Batched Kakao price alerts. Price drops found by the collector are saved
 * as in-app notifications right away, but their Kakao copies are queued
 * (notifications.kakao_pending) and sent from here instead, at most once per
 * user per window (admin setting, default 60 minutes):
 *  - one product waiting → that product's usual alert;
 *  - several → one summary: the biggest drop as the card (image, headline,
 *    price table), plus a button to the full list on the web.
 * The first alert after a quiet period still goes out on the next pass
 * (within ~30s); only the ones right after it wait and get combined.
 * Browser push (lib/webPush.ts) goes out with each message, saying the
 * same thing, and the window counts a send on either channel.
 *
 * Called by the collector worker after every poll, and by the local-dev
 * cron route. Never throws.
 */
export async function flushKakaoBatches(now = new Date()): Promise<void> {
  let userIds: string[];
  let windowMinutes: number;
  let templates: { title: string; body: string };
  try {
    userIds = await listUsersWithPendingKakao();
    if (userIds.length === 0) return;
    const settings = await getKakaoBatchSettings();
    windowMinutes = settings.windowMinutes;
    templates = { title: settings.summaryTitleTemplate, body: settings.summaryTemplate };
  } catch (err) {
    await recordError({ source: "kakao-batch:load", error: err });
    return;
  }

  for (const userId of userIds) {
    try {
      const lastSentAt = [await getLastKakaoSentAt(userId), await getLastPushSentAt(userId)]
        .filter((t): t is string => t != null)
        .map((t) => new Date(t).getTime())
        .reduce((a, b) => Math.max(a, b), 0);
      if (now.getTime() - lastSentAt < windowMinutes * 60_000) continue;

      const pending = await listPendingKakaoForUser(userId);
      if (pending.length === 0) continue;
      await sendBatch(userId, pending, templates);
      // Cleared even when the send failed or was skipped: the outcome is in
      // the send log, and retrying would only re-send stale prices later.
      await clearKakaoPending(pending.map((n) => n.id));
    } catch (err) {
      await recordError({ source: "kakao-batch:user", error: err, userId });
    }
  }
}

async function sendBatch(
  userId: string,
  pending: PendingKakaoNotification[],
  templates: { title: string; body: string }
): Promise<void> {
  // A product reaching its target price produces both a price_drop and a
  // target_price notification; per product, keep the latest prices and
  // prefer the target alert.
  const byProduct = new Map<string, PendingKakaoNotification>();
  for (const n of pending) {
    const current = byProduct.get(n.productId);
    if (!current || n.type === "target_price" || current.type !== "target_price") byProduct.set(n.productId, n);
  }
  const products = [...byProduct.values()];

  if (products.length === 1) {
    const [n] = products;
    runLog(`카카오 알림 발송 · 사용자 ${userId} · 상품 ${n.productId}`, "kakao");
    const alert = { type: n.type, productId: n.productId, oldPrice: n.oldPrice, newPrice: n.newPrice, targetPrice: n.targetPrice };
    await sendKakaoNotification(userId, alert);
    await sendProductWebPush(userId, alert);
    return;
  }

  const drop = (n: PendingKakaoNotification) => (n.oldPrice != null && n.newPrice != null ? n.oldPrice - n.newPrice : 0);
  const top = products.reduce((best, n) => (drop(n) > drop(best) ? n : best));
  const [topProduct, range] = await Promise.all([getProductById(top.productId), getPriceRange(top.productId)]);
  const vars = {
    count: products.length,
    targetCount: products.filter((n) => n.type === "target_price").length,
    topProductName: topProduct?.name ?? top.productId,
    topBrand: topProduct?.brand ?? "",
    topOldPrice: top.oldPrice,
    topNewPrice: top.newPrice,
    topIsLowest: top.newPrice != null && range != null && top.newPrice <= range.min,
  };
  const title = renderSummaryTemplate(templates.title, vars);
  const description = renderSummaryTemplate(templates.body, vars);
  runLog(`카카오 묶음 알림 발송 · 사용자 ${userId} · 상품 ${products.length}개 · 대표 ${top.productId}`, "kakao");
  await sendKakaoSummary(userId, {
    items: products.map((n) => ({ productId: n.productId, type: n.type })),
    title,
    description,
    top: {
      productId: top.productId,
      name: vars.topProductName,
      brand: vars.topBrand,
      imageUrl: topProduct?.imageUrl ?? null,
      oldPrice: top.oldPrice,
      newPrice: top.newPrice,
    },
  });
  // A notification has no price table, so the biggest drop goes on a line of its own.
  const priceLine =
    top.oldPrice != null && top.newPrice != null
      ? `\n${truncateProductName(vars.topProductName)} ${formatKrw(top.oldPrice)} → ${formatKrw(top.newPrice)}`
      : "";
  await sendWebPushToUser(userId, {
    title,
    body: description + priceLine,
    url: `${getBaseUrl()}/my#notifications`,
    image: topProduct?.imageUrl ?? null,
    tag: "price-summary",
  });
}
