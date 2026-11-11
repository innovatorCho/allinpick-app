import { formatKrw } from "@/lib/format";
import { deleteSetting, getSettingsByPrefix, setSetting } from "./settings";
import { truncateProductName } from "./kakaoTemplates";

/**
 * Admin settings for batched Kakao price alerts (lib/kakaoBatch.ts): at most
 * one Kakao message per user per `windowMinutes`, and the title and body of
 * the summary sent when it covers two or more products. The summary card
 * also shows the biggest drop's price table (before / now / amount / rate),
 * built from the data, not from these templates.
 *
 * Each value resolves admin setting (app_settings "kakao_batch.<field>") →
 * environment variable → default, like lib/domain/siteSettings.ts.
 */

const DB_PREFIX = "kakao_batch.";

export const DEFAULT_BATCH_WINDOW_MINUTES = 60;
export const MAX_BATCH_WINDOW_MINUTES = 24 * 60;
export const SUMMARY_TEMPLATE_MAX_LENGTH = 400;
export const SUMMARY_TITLE_MAX_LENGTH = 60;

// Kakao shows the card's title and body in about 4 lines together, so both
// stay short; the price details are in the price table below them.
export const DEFAULT_SUMMARY_TITLE_TEMPLATE = "🔥 {topDropAmount} 내렸어요! ({topDropRate}% ↓)";
export const DEFAULT_SUMMARY_TEMPLATE =
  "{topLowestNote}관심 상품 {count}개의 가격이 내려갔어요. 품절 전에 확인해보세요 👇";

export const SUMMARY_TEMPLATE_PLACEHOLDERS = [
  "count",
  "otherCount",
  "targetCount",
  "topProductName",
  "topBrand",
  "topOldPrice",
  "topNewPrice",
  "topDropAmount",
  "topDropRate",
  "topLowestNote",
];

export type BatchSettingSource = "admin" | "env" | "default";

export interface KakaoBatchSettings {
  windowMinutes: number;
  summaryTitleTemplate: string;
  summaryTemplate: string;
  sources: {
    windowMinutes: BatchSettingSource;
    summaryTitleTemplate: BatchSettingSource;
    summaryTemplate: BatchSettingSource;
  };
}

function parseMinutes(raw: string | undefined | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= MAX_BATCH_WINDOW_MINUTES ? n : null;
}

export async function getKakaoBatchSettings(): Promise<KakaoBatchSettings> {
  const saved = await getSettingsByPrefix(DB_PREFIX);
  const adminMinutes = parseMinutes(saved.get(`${DB_PREFIX}windowMinutes`));
  const envMinutes = parseMinutes(process.env.KAKAO_BATCH_WINDOW_MINUTES);
  const adminTitle = saved.get(`${DB_PREFIX}summaryTitleTemplate`)?.trim();
  const envTitle = process.env.KAKAO_SUMMARY_TITLE_TEMPLATE?.trim();
  const adminTemplate = saved.get(`${DB_PREFIX}summaryTemplate`)?.trim();
  const envTemplate = process.env.KAKAO_SUMMARY_TEMPLATE?.trim();
  return {
    windowMinutes: adminMinutes ?? envMinutes ?? DEFAULT_BATCH_WINDOW_MINUTES,
    summaryTitleTemplate: adminTitle || envTitle || DEFAULT_SUMMARY_TITLE_TEMPLATE,
    summaryTemplate: adminTemplate || envTemplate || DEFAULT_SUMMARY_TEMPLATE,
    sources: {
      windowMinutes: adminMinutes != null ? "admin" : envMinutes != null ? "env" : "default",
      summaryTitleTemplate: adminTitle ? "admin" : envTitle ? "env" : "default",
      summaryTemplate: adminTemplate ? "admin" : envTemplate ? "env" : "default",
    },
  };
}

/** Empty input removes the saved value, so the env var or default applies again. */
export async function saveKakaoBatchSettings(input: {
  windowMinutes: string;
  summaryTitleTemplate: string;
  summaryTemplate: string;
}): Promise<{ error?: string }> {
  const minutesRaw = input.windowMinutes.trim();
  const minutes = parseMinutes(minutesRaw);
  if (minutesRaw !== "" && minutes == null) {
    return { error: `발송 간격은 0~${MAX_BATCH_WINDOW_MINUTES} 사이의 분 단위 숫자로 입력해주세요.` };
  }
  const title = input.summaryTitleTemplate.replace(/\s+/g, " ").trim();
  if (title.length > SUMMARY_TITLE_MAX_LENGTH) {
    return { error: `요약 제목은 ${SUMMARY_TITLE_MAX_LENGTH}자 이하로 입력해주세요.` };
  }
  const template = input.summaryTemplate.trim();
  if (template.length > SUMMARY_TEMPLATE_MAX_LENGTH) {
    return { error: `요약 본문은 ${SUMMARY_TEMPLATE_MAX_LENGTH}자 이하로 입력해주세요.` };
  }

  if (minutes != null) await setSetting(`${DB_PREFIX}windowMinutes`, String(minutes));
  else await deleteSetting(`${DB_PREFIX}windowMinutes`);
  if (title) await setSetting(`${DB_PREFIX}summaryTitleTemplate`, title);
  else await deleteSetting(`${DB_PREFIX}summaryTitleTemplate`);
  if (template) await setSetting(`${DB_PREFIX}summaryTemplate`, template);
  else await deleteSetting(`${DB_PREFIX}summaryTemplate`);
  return {};
}

export interface SummaryTemplateVars {
  count: number;
  targetCount: number;
  topProductName: string;
  topBrand: string;
  topOldPrice: number | null;
  topNewPrice: number | null;
  /** The new price is the lowest recorded since tracking began. */
  topIsLowest: boolean;
}

/** Percentage the biggest drop is down from its previous price, rounded; null without both prices. */
export function dropRate(oldPrice: number | null, newPrice: number | null): number | null {
  if (oldPrice == null || newPrice == null || oldPrice <= 0) return null;
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

/** Fills `{placeholder}` tokens; unknown ones stay visible, like renderKakaoTemplate. */
export function renderSummaryTemplate(template: string, vars: SummaryTemplateVars): string {
  const drop = vars.topOldPrice != null && vars.topNewPrice != null ? vars.topOldPrice - vars.topNewPrice : null;
  const rate = dropRate(vars.topOldPrice, vars.topNewPrice);
  const values: Record<string, string> = {
    count: String(vars.count),
    otherCount: String(Math.max(0, vars.count - 1)),
    targetCount: String(vars.targetCount),
    topProductName: truncateProductName(vars.topProductName),
    topBrand: vars.topBrand,
    topOldPrice: vars.topOldPrice != null ? formatKrw(vars.topOldPrice) : "-",
    topNewPrice: vars.topNewPrice != null ? formatKrw(vars.topNewPrice) : "-",
    topDropAmount: drop != null ? formatKrw(drop) : "-",
    topDropRate: rate != null ? String(rate) : "-",
    // Empty when not the lowest, so it can lead a sentence in the template.
    topLowestNote: vars.topIsLowest ? "🏆 추적 시작 이후 최저가예요! " : "",
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}
