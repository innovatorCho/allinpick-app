import { getSetting, setSetting } from "./settings";
import { formatKrw } from "@/lib/format";
import type { NotificationType } from "./types";

/**
 * Admin-editable KakaoTalk "나에게 보내기" message config, sent alongside each
 * in-app notification (lib/kakaoMessaging.ts) — kept separate from the in-app
 * notification's own `message` string (lib/domain/notifications.ts) since the
 * two audiences want different tones/lengths/formats, and an admin should be
 * able to tune the KakaoTalk copy without touching code.
 *
 * Persisted in the same `app_settings` key-value store the scheduler config
 * uses (lib/domain/schedulerSettings.ts) — one row per notification type.
 */

const SETTINGS_KEY_PREFIX = "kakao_template:";

/**
 * Which Kakao "기본 템플릿" object_type an admin can pick per notification
 * type. Kakao's default templates also include list/location/calendar, but
 * those don't fit a single-product price alert, so they're deliberately not
 * exposed here (see chat history design discussion). "commerce" (price
 * fields rendered natively by KakaoTalk) is left out for now too — its exact
 * field shape (standalone object_type vs. a sub-object of feed) needs a
 * doc re-check right before it's added.
 */
export type KakaoObjectType = "text" | "feed";

export interface KakaoTemplateConfig {
  objectType: KakaoObjectType;
  /** {placeholder}-style text, rendered by renderKakaoTemplate below. */
  template: string;
}

const VALID_OBJECT_TYPES: KakaoObjectType[] = ["text", "feed"];

export const DEFAULT_KAKAO_TEMPLATES: Record<NotificationType, KakaoTemplateConfig> = {
  // feed형 기본값: 카드 제목(content.title)에 상품명이 이미 따로 보이므로, 본문에는
  // [{productName}]을 반복하지 않고 가격 정보만 아이콘과 함께 짧고 눈에 띄게 넣음.
  price_drop: {
    objectType: "feed",
    template: "🏷️ {oldPrice} → 🔥 {newPrice}\n📉 {dropAmount} 하락했습니다!",
  },
  target_price: {
    objectType: "text",
    template: "🎯 목표가 도달!\n[{productName}]\n\n목표가 {targetPrice} 이하 달성\n현재가 {newPrice}",
  },
};

// Kakao's own truncation point for a feed card's title (and, less visibly, for
// {productName} inside the body) isn't precisely documented and varies by
// device/font — so instead of leaving it to guesswork, we cut product names
// ourselves at a fixed, predictable length with "…". That way, if a message
// still looks cut off after this, an admin knows it's Kakao's own
// image/description-length limit doing it, not an unpredictable name cutoff.
export const PRODUCT_NAME_MAX_LENGTH = 30;

export function truncateProductName(name: string): string {
  if (name.length <= PRODUCT_NAME_MAX_LENGTH) return name;
  return `${name.slice(0, PRODUCT_NAME_MAX_LENGTH - 1).trimEnd()}…`;
}

// Placeholders each template type actually supports — surfaced in the admin UI
// so an admin editing a template knows what's available for each notification kind.
export const KAKAO_TEMPLATE_PLACEHOLDERS: Record<NotificationType, string[]> = {
  price_drop: ["productName", "oldPrice", "newPrice", "dropAmount", "productUrl"],
  target_price: ["productName", "targetPrice", "newPrice", "productUrl"],
};

/**
 * Settings were a plain template string before object_type selection
 * existed. If what's stored doesn't parse as our current `{objectType,
 * template}` shape, it's one of those — treat it as a "text" template rather
 * than requiring a DB migration to upgrade it.
 */
function parseStoredTemplate(raw: string | null, fallback: KakaoTemplateConfig): KakaoTemplateConfig {
  if (raw == null) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "template" in parsed &&
      typeof (parsed as { template: unknown }).template === "string" &&
      "objectType" in parsed &&
      VALID_OBJECT_TYPES.includes((parsed as { objectType: KakaoObjectType }).objectType)
    ) {
      return parsed as KakaoTemplateConfig;
    }
  } catch {
    // Not JSON at all — definitely a legacy plain-text template.
  }
  return { objectType: "text", template: raw };
}

export async function getKakaoTemplate(type: NotificationType): Promise<KakaoTemplateConfig> {
  return parseStoredTemplate(await getSetting(SETTINGS_KEY_PREFIX + type), DEFAULT_KAKAO_TEMPLATES[type]);
}

export async function getAllKakaoTemplates(): Promise<Record<NotificationType, KakaoTemplateConfig>> {
  const [price_drop, target_price] = await Promise.all([getKakaoTemplate("price_drop"), getKakaoTemplate("target_price")]);
  return { price_drop, target_price };
}

export async function setKakaoTemplate(type: NotificationType, config: KakaoTemplateConfig): Promise<void> {
  await setSetting(SETTINGS_KEY_PREFIX + type, JSON.stringify(config));
}

/** Reverts a type's template (and object_type) back to the built-in default. */
export async function resetKakaoTemplate(type: NotificationType): Promise<void> {
  await setSetting(SETTINGS_KEY_PREFIX + type, JSON.stringify(DEFAULT_KAKAO_TEMPLATES[type]));
}

export interface KakaoTemplateVars {
  productName: string;
  oldPrice?: number | null;
  newPrice?: number | null;
  targetPrice?: number | null;
  productUrl: string;
}

/**
 * Fills a template's `{placeholder}` tokens. An unrecognized token (typo, or
 * one that doesn't apply to this notification type) is left in the output
 * as-is rather than silently turning into "undefined" — that's a visible,
 * self-explanatory signal to an admin previewing/testing the template.
 */
export function renderKakaoTemplate(template: string, vars: KakaoTemplateVars): string {
  const dropAmount = vars.oldPrice != null && vars.newPrice != null ? vars.oldPrice - vars.newPrice : null;
  const values: Record<string, string> = {
    productName: truncateProductName(vars.productName),
    oldPrice: vars.oldPrice != null ? formatKrw(vars.oldPrice) : "-",
    newPrice: vars.newPrice != null ? formatKrw(vars.newPrice) : "-",
    targetPrice: vars.targetPrice != null ? formatKrw(vars.targetPrice) : "-",
    dropAmount: dropAmount != null ? formatKrw(dropAmount) : "-",
    productUrl: vars.productUrl,
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}
