import { cache } from "react";
import { getSettingsByPrefix, setSetting, deleteSetting } from "./settings";

/**
 * Operator info and site-wide notices (footer, privacy policy, price
 * disclaimer). Editable by admins at /admin/settings so changing copy never
 * needs a code change or redeploy.
 *
 * Each value resolves in this order:
 *   1. the value an admin saved (app_settings, key "site.<field>")
 *   2. the environment variable named in `env`
 *   3. `defaultValue` (null for operator-specific facts nobody can guess)
 */

export type SiteSettingKey =
  | "serviceName"
  | "operatorName"
  | "privacyOfficerName"
  | "contactEmail"
  | "privacyEffectiveDate"
  | "priceDisclaimer"
  | "footerNotice"
  | "pendingProductNotice"
  | "pendingProductRetryNotice"
  | "kakaoChannelUrl"
  | "kakaoChannelButtonLabel"
  | "pushOptInNotice"
  | "pushIosNotice"
  | "pushWelcomeMessage";

export interface SiteSettingField {
  key: SiteSettingKey;
  env: string;
  label: string;
  help: string;
  defaultValue: string | null;
  /** Legally required on the privacy policy; admins get a warning while empty. */
  required: boolean;
  multiline: boolean;
  maxLength: number;
  type?: "email" | "url";
}

export const SITE_SETTING_FIELDS: SiteSettingField[] = [
  {
    key: "serviceName",
    env: "SITE_SERVICE_NAME",
    label: "서비스 이름",
    help: "하단 문구와 개인정보 처리방침에 표시돼요.",
    defaultValue: "올인픽",
    required: true,
    multiline: false,
    maxLength: 50,
  },
  {
    key: "operatorName",
    env: "SITE_OPERATOR_NAME",
    label: "운영자 이름",
    help: "개인정보 처리방침 첫 문장에 들어가요. 개인이면 이름, 사업자면 상호를 적어주세요.",
    defaultValue: null,
    required: true,
    multiline: false,
    maxLength: 100,
  },
  {
    key: "privacyOfficerName",
    env: "SITE_PRIVACY_OFFICER_NAME",
    label: "개인정보 보호책임자",
    help: "법적으로 처리방침에 꼭 있어야 하는 항목이에요.",
    defaultValue: null,
    required: true,
    multiline: false,
    maxLength: 100,
  },
  {
    key: "contactEmail",
    env: "SITE_CONTACT_EMAIL",
    label: "문의 이메일",
    help: "하단과 개인정보 처리방침에 공개돼요. 탈퇴와 개인정보 요청을 받는 주소예요.",
    defaultValue: null,
    required: true,
    multiline: false,
    maxLength: 200,
    type: "email",
  },
  {
    key: "privacyEffectiveDate",
    env: "SITE_PRIVACY_EFFECTIVE_DATE",
    label: "처리방침 시행일",
    help: "처리방침 내용이 바뀌면 새 시행일로 고쳐주세요. (예: 2026년 11월 1일)",
    defaultValue: "2026년 11월 1일",
    required: true,
    multiline: false,
    maxLength: 50,
  },
  {
    key: "priceDisclaimer",
    env: "SITE_PRICE_DISCLAIMER",
    label: "가격 안내 문구",
    help: "모든 페이지 하단과 상품 상세의 구매 버튼 아래에 표시돼요.",
    defaultValue:
      "표시된 가격은 마지막으로 확인한 시점의 가격이며, 실제 올리브영 판매 가격과 다를 수 있어요. 구매 전 올리브영에서 최종 가격을 꼭 확인해주세요.",
    required: false,
    multiline: true,
    maxLength: 500,
  },
  {
    key: "footerNotice",
    env: "SITE_FOOTER_NOTICE",
    label: "하단 추가 안내",
    help: "모든 페이지 하단에 표시돼요.",
    defaultValue: "올인픽은 올리브영이 운영하는 공식 서비스가 아니에요.",
    required: false,
    multiline: true,
    maxLength: 500,
  },
  {
    key: "pendingProductNotice",
    env: "SITE_PENDING_PRODUCT_NOTICE",
    label: "상품 정보 수집 중 안내",
    help: "방금 등록해서 아직 이름과 가격을 가져오지 못한 상품의 상세 화면에 표시돼요.",
    defaultValue: "등록이 완료됐어요. 상품 이름과 가격을 가져오는 중이에요. 보통 1~2분 안에 채워져요.",
    required: false,
    multiline: true,
    maxLength: 300,
  },
  {
    key: "pendingProductRetryNotice",
    env: "SITE_PENDING_PRODUCT_RETRY_NOTICE",
    label: "상품 정보 재시도 안내",
    help: "등록한 상품의 정보를 가져오지 못해 다시 시도하는 동안 상세 화면에 표시돼요.",
    defaultValue: "등록은 완료됐지만 상품 정보를 아직 가져오지 못했어요. 자동으로 다시 시도하고 있으니 잠시 후 확인해주세요.",
    required: false,
    multiline: true,
    maxLength: 300,
  },
  {
    key: "kakaoChannelUrl",
    env: "SITE_KAKAO_CHANNEL_URL",
    label: "카카오톡 채널 주소",
    help: "채널 관리자센터의 채널 URL(예: http://pf.kakao.com/_xxxxx)이에요. 넣으면 하단과 내 관심상품 화면에 채널 추가 버튼이 보여요.",
    defaultValue: null,
    required: false,
    multiline: false,
    maxLength: 200,
    type: "url",
  },
  {
    key: "kakaoChannelButtonLabel",
    env: "SITE_KAKAO_CHANNEL_BUTTON_LABEL",
    label: "채널 추가 버튼 문구",
    help: "카카오톡 채널 추가 버튼에 표시돼요.",
    defaultValue: "카카오톡 채널 추가하고 소식 받기",
    required: false,
    multiline: false,
    maxLength: 40,
  },
  {
    key: "pushOptInNotice",
    env: "SITE_PUSH_OPT_IN_NOTICE",
    label: "기기 알림 안내",
    help: "내 관심상품 화면의 '이 기기에서 알림 받기' 버튼 위에 표시돼요.",
    defaultValue: "가격이 내려가면 이 기기로도 바로 알려드려요. 휴대폰과 PC에서 각각 켤 수 있어요.",
    required: false,
    multiline: true,
    maxLength: 300,
  },
  {
    key: "pushIosNotice",
    env: "SITE_PUSH_IOS_NOTICE",
    label: "아이폰 알림 안내",
    help: "아이폰에서 홈 화면에 추가하지 않고 사이트를 열었을 때, 알림 버튼 대신 표시돼요.",
    defaultValue: "아이폰은 Safari 아래쪽 공유 버튼 → '홈 화면에 추가'를 누른 뒤, 홈 화면에 생긴 아이콘으로 들어와서 알림을 켤 수 있어요.",
    required: false,
    multiline: true,
    maxLength: 300,
  },
  {
    key: "pushWelcomeMessage",
    env: "SITE_PUSH_WELCOME_MESSAGE",
    label: "기기 알림 켬 확인 메시지",
    help: "사용자가 기기 알림을 켜는 순간 그 기기로 보내는 확인 알림 내용이에요. 제목은 서비스 이름이에요.",
    defaultValue: "알림이 켜졌어요! 관심 상품 가격이 내려가면 이렇게 알려드릴게요 🔔",
    required: false,
    multiline: false,
    maxLength: 100,
  },
];

export type SiteSettingSource = "admin" | "env" | "default" | "none";

export type SiteSettings = Record<SiteSettingKey, string | null>;

export interface SiteSettingsWithSources {
  values: SiteSettings;
  sources: Record<SiteSettingKey, SiteSettingSource>;
  missingRequired: SiteSettingField[];
}

const DB_PREFIX = "site.";

async function loadSiteSettings(): Promise<SiteSettingsWithSources> {
  let saved = new Map<string, string>();
  try {
    saved = await getSettingsByPrefix(DB_PREFIX);
  } catch (err) {
    // Footer and policy text must still render if the DB is briefly down;
    // env/default values are better than an error page for this.
    console.error("[site-settings] 저장된 설정을 불러오지 못해 환경변수/기본값을 사용합니다:", err);
  }

  const values = {} as SiteSettings;
  const sources = {} as Record<SiteSettingKey, SiteSettingSource>;
  for (const field of SITE_SETTING_FIELDS) {
    const fromDb = saved.get(DB_PREFIX + field.key)?.trim();
    const fromEnv = process.env[field.env]?.trim();
    if (fromDb) {
      values[field.key] = fromDb;
      sources[field.key] = "admin";
    } else if (fromEnv) {
      values[field.key] = fromEnv;
      sources[field.key] = "env";
    } else if (field.defaultValue) {
      values[field.key] = field.defaultValue;
      sources[field.key] = "default";
    } else {
      values[field.key] = null;
      sources[field.key] = "none";
    }
  }

  return {
    values,
    sources,
    missingRequired: SITE_SETTING_FIELDS.filter((f) => f.required && values[f.key] == null),
  };
}

/** Cached per request, so layout and page share one DB read. */
export const getSiteSettingsWithSources = cache(loadSiteSettings);

export async function getSiteSettings(): Promise<SiteSettings> {
  return (await getSiteSettingsWithSources()).values;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Saves the admin form. An empty field removes the saved value, so the
 * env var or default applies again. Returns a field-specific error message
 * on invalid input, without saving anything.
 */
export async function saveSiteSettings(input: Partial<Record<SiteSettingKey, string>>): Promise<{ error?: string }> {
  const cleaned: [SiteSettingField, string][] = [];
  for (const field of SITE_SETTING_FIELDS) {
    const raw = input[field.key];
    if (raw === undefined) continue;
    const value = field.multiline ? raw.trim() : raw.replace(/\s+/g, " ").trim();
    if (value.length > field.maxLength) {
      return { error: `${field.label}은(는) ${field.maxLength}자 이하로 입력해주세요.` };
    }
    if (value && field.type === "email" && !EMAIL_PATTERN.test(value)) {
      return { error: `${field.label} 형식이 올바르지 않아요.` };
    }
    if (value && field.type === "url" && !/^https?:\/\/\S+$/.test(value)) {
      return { error: `${field.label}은(는) http:// 또는 https://로 시작하는 주소로 입력해주세요.` };
    }
    cleaned.push([field, value]);
  }

  for (const [field, value] of cleaned) {
    if (value) await setSetting(DB_PREFIX + field.key, value);
    else await deleteSetting(DB_PREFIX + field.key);
  }
  return {};
}
