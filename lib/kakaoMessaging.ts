import { getOAuthAccount, updateOAuthTokens } from "@/lib/domain/users";
import { getProductById } from "@/lib/domain/products";
import { getKakaoTemplate, renderKakaoTemplate, truncateProductName, type KakaoObjectType } from "@/lib/domain/kakaoTemplates";
import { recordKakaoSendLog } from "@/lib/domain/kakaoSendLogs";
import { recordDigestLog } from "@/lib/domain/kakaoDigestLogs";
import { refreshKakaoAccessToken, getBaseUrl } from "@/lib/auth/providers";
import { runAfterResponse } from "@/lib/runAfterResponse";
import { formatKrw } from "@/lib/format";
import type { NotificationType } from "@/lib/domain/types";

/**
 * KakaoTalk "나에게 보내기" (Memo API) sending — Method B from the design
 * discussion: no business/알림톡 registration needed, works with the same
 * Kakao login the app already has, but only reaches the logged-in Kakao
 * account itself (self-notification), and only while the Kakao app is in
 * "development" stage for accounts registered as testers, or after the app
 * passes Kakao's review for production use.
 *
 * Every entry point here is best-effort and MUST NEVER throw past its own
 * boundary — a Kakao API failure (missing talk_message consent, expired
 * token, no linked account, network error) can never be allowed to break
 * in-app notification creation, which is the feature that actually matters.
 */

const MEMO_SEND_URL = "https://kapi.kakao.com/v2/api/talk/memo/default/send";

// Refresh a little before the recorded expiry so we don't race a 401 on a
// token that's valid-on-read but expires mid-request.
const EXPIRY_SAFETY_MARGIN_MS = 5 * 60_000;

/**
 * Returns a Kakao access token usable right now for `userId`, refreshing the
 * stored one first if it looks expired. Returns null if the user has never
 * linked a Kakao account (e.g. they signed in with Google) — that's a normal,
 * silent no-op, not an error.
 */
async function getValidKakaoAccessToken(userId: string): Promise<string | null> {
  const account = await getOAuthAccount(userId, "kakao");
  if (!account?.access_token) return null;

  const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null;
  const isExpiring = expiresAt != null && expiresAt - EXPIRY_SAFETY_MARGIN_MS < Date.now();
  if (!isExpiring) return account.access_token;
  if (!account.refresh_token) return account.access_token; // no way to refresh — try the possibly-stale token anyway

  try {
    const refreshed = await refreshKakaoAccessToken(account.refresh_token);
    await updateOAuthTokens("kakao", account.provider_user_id, refreshed);
    return refreshed.accessToken;
  } catch {
    // Refresh failed (e.g. refresh_token itself expired) — fall back to the
    // old access token; the send call below will fail cleanly if it's truly dead.
    return account.access_token;
  }
}

/**
 * Builds the Kakao "기본 템플릿" `template_object` payload for the chosen
 * object_type. `feed` requires an image; a product that was never
 * successfully collected (no image_url yet) silently falls back to `text`
 * instead of sending a broken/rejected request — best-effort never lets a
 * cosmetic choice block the message going out at all.
 */
export function buildKakaoTemplateObject(
  objectType: KakaoObjectType,
  input: { text: string; productName: string; imageUrl: string | null; productUrl: string }
): Record<string, unknown> {
  const link = { web_url: input.productUrl, mobile_web_url: input.productUrl };

  if (objectType === "feed" && input.imageUrl) {
    return {
      object_type: "feed",
      content: {
        title: truncateProductName(input.productName),
        description: input.text,
        image_url: input.imageUrl,
        link,
      },
      buttons: [{ title: "상품 보기", link }],
    };
  }

  return {
    object_type: "text",
    text: input.text,
    link,
    button_title: "상품 보기",
  };
}

async function sendKakaoMemoToSelf(accessToken: string, templateObject: Record<string, unknown>): Promise<void> {
  const res = await fetch(MEMO_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ template_object: JSON.stringify(templateObject) }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`카카오톡 메시지 전송 실패 (HTTP ${res.status}): ${body}`);
  }
}

export interface KakaoNotifyInput {
  type: NotificationType;
  productId: string;
  oldPrice?: number | null;
  newPrice?: number | null;
  /** Only meaningful for type "target_price" — the threshold the user set. */
  targetPrice?: number | null;
}

/**
 * Attempts to KakaoTalk-notify `userId` via "나에게 보내기", using the
 * admin-configurable template for this notification `type`
 * (lib/domain/kakaoTemplates.ts) rather than the in-app notification's own
 * message text — the two are allowed to read differently.
 *
 * Never throws and is never awaited by callers — an in-app notification row
 * is already committed by the time this runs, so a Kakao-side failure here
 * only means the KakaoTalk copy doesn't arrive, never that the notification
 * itself was lost. Runs via runAfterResponse (Next's `after()`), not a bare
 * detached promise — a server restart or (on Vercel) a serverless function
 * freezing right after the response went out used to be able to kill this
 * mid-flight with zero trace, not even a "failed" log row (confirmed for
 * real: see chat history, a real price-drop's Kakao send vanished exactly
 * like this). `after()` is backed by Vercel's `waitUntil` there, so the
 * function's execution is kept alive until this actually finishes.
 */
export function sendKakaoNotificationBestEffort(userId: string, input: KakaoNotifyInput): void {
  runAfterResponse(() => sendKakaoNotification(userId, input));
}

/**
 * Logging itself must never be able to break (or mask the outcome of) the
 * send it's recording — a DB write failure here is swallowed and only
 * console-logged, same as every other failure mode in this file.
 */
async function logSend(
  userId: string,
  productId: string,
  type: NotificationType,
  status: "sent" | "skipped" | "failed",
  detail?: string | null
): Promise<void> {
  try {
    await recordKakaoSendLog({ userId, productId, type, status, detail });
  } catch (err) {
    console.error(`[kakaoMessaging] 발송 로그 기록 실패:`, err instanceof Error ? err.message : err);
  }
}

/**
 * One product's alert text from the admin template for its type, plus what
 * a message needs around it. Shared with browser push (lib/webPush.ts) so
 * both channels say the same thing. Null when the product is gone.
 */
export async function renderNotificationContent(input: KakaoNotifyInput): Promise<{
  objectType: KakaoObjectType;
  text: string;
  productName: string;
  imageUrl: string | null;
  productUrl: string;
} | null> {
  const product = await getProductById(input.productId);
  if (!product) return null;
  const productUrl = `${getBaseUrl()}/product/${input.productId}`;
  const { objectType, template } = await getKakaoTemplate(input.type);
  const text = renderKakaoTemplate(template, {
    productName: product.name,
    oldPrice: input.oldPrice ?? null,
    newPrice: input.newPrice ?? null,
    targetPrice: input.targetPrice ?? null,
    productUrl,
  });
  return { objectType, text, productName: product.name, imageUrl: product.imageUrl, productUrl };
}

/**
 * The single-product send itself, awaited. Never throws. Used directly by
 * the batched sender (lib/kakaoBatch.ts), which runs in the collector
 * worker with no request to attach `after()` to.
 */
export async function sendKakaoNotification(userId: string, input: KakaoNotifyInput): Promise<void> {
  const log = (status: "sent" | "skipped" | "failed", detail?: string | null) =>
    logSend(userId, input.productId, input.type, status, detail);
  try {
    const token = await getValidKakaoAccessToken(userId);
    if (!token) {
      await log("skipped", "연동된 카카오 계정이 없거나 talk_message 동의 토큰이 없음");
      return;
    }

    const content = await renderNotificationContent(input);
    if (!content) {
      // shouldn't happen (FK guarantees the row exists) — never let a lookup miss crash a best-effort send
      await log("skipped", "상품 정보를 찾을 수 없음");
      return;
    }

    const templateObject = buildKakaoTemplateObject(content.objectType, content);

    await sendKakaoMemoToSelf(token, templateObject);
    await log("sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kakaoMessaging] user ${userId} 발송 실패:`, message);
    await log("failed", message);
  }
}

export interface KakaoSummaryItem {
  productId: string;
  type: NotificationType;
}

/**
 * One Kakao message covering several products' alerts (lib/kakaoBatch.ts).
 * The product that dropped the most is the card: its image, a headline and
 * body from the admin templates, and Kakao's price table (item_content:
 * previous / current / amount, with the drop rate as the bold total).
 * Buttons open that product and the full notification list on the web.
 * Falls back to a text message when the product has no image. Logged once
 * per item, so the admin send history still lists every product. Never throws.
 *
 * item_content display limits (Kakao docs): item label 6 chars, item value
 * 14 chars on one line, title_image_text 24 chars, category 14, sum 6,
 * sum_op 11.
 */
export async function sendKakaoSummary(
  userId: string,
  input: {
    items: KakaoSummaryItem[];
    title: string;
    description: string;
    top: { productId: string; name: string; brand: string; imageUrl: string | null; oldPrice: number | null; newPrice: number | null };
  }
): Promise<void> {
  const detail = `묶음 발송 (${input.items.length}건)`;
  const logAll = async (status: "sent" | "skipped" | "failed", extra?: string) => {
    for (const item of input.items) {
      await logSend(userId, item.productId, item.type, status, extra ? `${detail} · ${extra}` : detail);
    }
  };
  try {
    const token = await getValidKakaoAccessToken(userId);
    if (!token) {
      await logAll("skipped", "연동된 카카오 계정이 없거나 talk_message 동의 토큰이 없음");
      return;
    }
    await sendKakaoMemoToSelf(token, buildKakaoSummaryObject({ ...input, count: input.items.length }));
    await logAll("sent");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kakaoMessaging] user ${userId} 묶음 발송 실패:`, message);
    await logAll("failed", message);
  }
}

/**
 * OliveYoung names often start with promo tags ("[1+1리필기획/아이돌광채세럼] 비긴스…")
 * that would use up most of the price table's 24-character title.
 */
function withoutLeadingTags(name: string): string {
  const stripped = name.replace(/^(\s*\[[^\]]*\])+\s*/, "");
  return stripped || name;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function buildKakaoSummaryObject(input: {
  count: number;
  title: string;
  description: string;
  top: { productId: string; name: string; brand: string; imageUrl: string | null; oldPrice: number | null; newPrice: number | null };
}): Record<string, unknown> {
  const baseUrl = getBaseUrl();
  const allUrl = `${baseUrl}/my#notifications`;
  const allLink = { web_url: allUrl, mobile_web_url: allUrl };
  const topUrl = `${baseUrl}/product/${input.top.productId}`;
  const topLink = { web_url: topUrl, mobile_web_url: topUrl };
  const { oldPrice, newPrice } = input.top;
  const hasPrices = oldPrice != null && newPrice != null && oldPrice > 0;

  if (!input.top.imageUrl) {
    const priceLine = hasPrices
      ? `\n\n${truncateProductName(input.top.name)}\n${formatKrw(oldPrice)} → ${formatKrw(newPrice)} (${Math.round(((oldPrice - newPrice) / oldPrice) * 100)}% ↓)`
      : "";
    return { object_type: "text", text: `${input.title}\n${input.description}${priceLine}`, link: allLink, button_title: "모두 보기" };
  }

  return {
    object_type: "feed",
    content: {
      title: input.title,
      description: input.description,
      image_url: input.top.imageUrl,
      link: topLink,
    },
    ...(hasPrices
      ? {
          item_content: {
            title_image_text: clip(withoutLeadingTags(input.top.name), 24),
            title_image_category: clip(input.top.brand, 14),
            items: [
              { item: "이전 가격", item_op: formatKrw(oldPrice) },
              { item: "현재 가격", item_op: formatKrw(newPrice) },
              { item: "내린 금액", item_op: formatKrw(oldPrice - newPrice) },
            ],
            sum: "할인율",
            sum_op: `${Math.round(((oldPrice - newPrice) / oldPrice) * 100)}% ↓`,
          },
        }
      : {}),
    buttons: [
      { title: "이 상품 보기", link: topLink },
      { title: `${input.count}개 모두 보기`, link: allLink },
    ],
  };
}

/**
 * Sends the daily "오늘 N개 상품 가격이 내려갔어요" digest to one user and
 * records the outcome (lib/domain/kakaoDigestLogs.ts) — called from
 * lib/digestScheduler.ts's hourly check, not fire-and-forget like
 * sendKakaoNotificationBestEffort above: the caller there is already a
 * background scheduler tick (not a user-facing request it must not block),
 * so awaiting here lets it log the result before moving to the next user
 * instead of racing a second tick's idempotency check against an
 * in-flight send.
 */
export async function sendKakaoDigest(
  userId: string,
  digestDate: string,
  dropCount: number,
  /** Set when only one product dropped: the message then opens that product instead of the list. */
  singleProductId: string | null = null
): Promise<void> {
  try {
    const token = await getValidKakaoAccessToken(userId);
    if (!token) {
      await recordDigestLog({ userId, digestDate, dropCount, status: "skipped", detail: "연동된 카카오 계정이 없거나 talk_message 동의 토큰이 없음" });
      return;
    }

    // Built directly (not via buildKakaoTemplateObject) — that helper is
    // shaped around one product's name/image/link, none of which a digest
    // covering several products at once actually has.
    const url = singleProductId ? `${getBaseUrl()}/product/${singleProductId}` : `${getBaseUrl()}/my`;
    const templateObject = {
      object_type: "text",
      text: `📉 오늘 ${dropCount}개 상품의 가격이 내려갔어요!\n지금 확인해보세요 👇`,
      link: { web_url: url, mobile_web_url: url },
      button_title: singleProductId ? "상품 보기" : "내 추적 상품 보기",
    };

    await sendKakaoMemoToSelf(token, templateObject);
    await recordDigestLog({ userId, digestDate, dropCount, status: "sent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[kakaoMessaging] user ${userId} 다이제스트 발송 실패:`, message);
    await recordDigestLog({ userId, digestDate, dropCount, status: "failed", detail: message });
  }
}
