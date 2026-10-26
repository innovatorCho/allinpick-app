"use client";

import { useActionState, useState } from "react";
import {
  updateKakaoTemplateAction,
  resetKakaoTemplateAction,
  type KakaoTemplateFormState,
} from "@/lib/actions/admin-actions";
import { formatKrw } from "@/lib/format";
import type { NotificationType } from "@/lib/domain/types";
// Type-only — erased at compile time, so this never pulls lib/domain/kakaoTemplates.ts's
// db-backed code (getSetting/setSetting → node:sqlite) into the client bundle. The actual
// rendering logic below is a small local copy for the same reason (see renderPreview).
import type { KakaoObjectType, KakaoTemplateConfig } from "@/lib/domain/kakaoTemplates";

const initialState: KakaoTemplateFormState = {};

const TYPE_LABEL: Record<NotificationType, string> = {
  price_drop: "가격 하락 알림",
  target_price: "목표가 도달 알림",
};

const OBJECT_TYPE_LABEL: Record<KakaoObjectType, string> = {
  text: "텍스트형",
  feed: "피드형 (이미지 포함)",
};

// 일부러 길게 잡음 — 미리보기에서 말줄임 처리가 실제로 어떻게 보이는지 바로 확인할 수 있도록.
const PREVIEW_VARS = {
  productName: "예시 상품명이 아주 길게 들어오는 경우 테스트용 립밤 & 클렌징 세트",
  oldPrice: 26500,
  newPrice: 22900,
  targetPrice: 23000,
  productUrl: "https://example.com/product/A000000000",
};

// lib/domain/kakaoTemplates.ts의 값과 반드시 같이 맞춰야 함 — 실제 발송 로직과 이 미리보기가
// 서로 다른 길이에서 잘리면 미리보기가 무의미해짐.
const PRODUCT_NAME_MAX_LENGTH = 30;

/**
 * 아래 두 함수는 lib/domain/kakaoTemplates.ts의 truncateProductName/renderKakaoTemplate과
 * 동일한 로직을 그대로 복제한 것 — 그 모듈은 db 연동 코드(getSetting/setSetting → node:sqlite)를
 * 끌고 오기 때문에 클라이언트 컴포넌트에서 직접 import할 수 없음(위 주석 참고). 이 관리자
 * 미리보기 전용이며, 실제 발송에는 쓰이지 않음.
 */
function truncateProductName(name: string): string {
  if (name.length <= PRODUCT_NAME_MAX_LENGTH) return name;
  return `${name.slice(0, PRODUCT_NAME_MAX_LENGTH - 1).trimEnd()}…`;
}

function renderPreview(template: string): string {
  const dropAmount = PREVIEW_VARS.oldPrice - PREVIEW_VARS.newPrice;
  const values: Record<string, string> = {
    productName: truncateProductName(PREVIEW_VARS.productName),
    oldPrice: formatKrw(PREVIEW_VARS.oldPrice),
    newPrice: formatKrw(PREVIEW_VARS.newPrice),
    targetPrice: formatKrw(PREVIEW_VARS.targetPrice),
    dropAmount: formatKrw(dropAmount),
    productUrl: PREVIEW_VARS.productUrl,
  };
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? values[key] : match));
}

export function KakaoTemplateForm({
  type,
  config,
  placeholders,
}: {
  type: NotificationType;
  config: KakaoTemplateConfig;
  placeholders: string[];
}) {
  const [state, action, pending] = useActionState(updateKakaoTemplateAction, initialState);
  const [objectType, setObjectType] = useState<KakaoObjectType>(config.objectType);
  const [templateText, setTemplateText] = useState(config.template);

  const previewText = renderPreview(templateText);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">{TYPE_LABEL[type]}</h3>

      <p className="text-xs text-zinc-500">
        사용 가능한 변수:{" "}
        {placeholders.map((p) => (
          <code
            key={p}
            className="mx-0.5 rounded bg-zinc-100 px-1 py-0.5 text-[11px] dark:bg-zinc-800"
          >{`{${p}}`}</code>
        ))}
      </p>
      <p className="text-xs text-zinc-400">
        {`{productName}`}이 {PRODUCT_NAME_MAX_LENGTH}자를 넘으면 자동으로 말줄임(…) 처리됩니다 — 그래도 메시지가
        잘려 보인다면 상품명이 아니라 카카오톡 자체의 길이 제한 때문입니다.
      </p>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="type" value={type} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">메시지 형식</span>
          <select
            name="objectType"
            value={objectType}
            onChange={(e) => setObjectType(e.target.value as KakaoObjectType)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(Object.entries(OBJECT_TYPE_LABEL) as [KakaoObjectType, string][]).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {objectType === "feed" && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            상품 이미지가 없는 상품(수집 전 등)은 자동으로 텍스트형으로 발송됩니다.
          </p>
        )}

        <textarea
          name="template"
          value={templateText}
          onChange={(e) => setTemplateText(e.target.value)}
          rows={4}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {pending ? "저장 중..." : "저장"}
          </button>
        </div>
        {state.error && <p className="text-xs text-red-600">{state.error}</p>}
        {state.success && <p className="text-xs text-emerald-600">저장되었습니다.</p>}
      </form>

      <form action={resetKakaoTemplateAction.bind(null, type)}>
        <button type="submit" className="text-xs text-zinc-500 underline hover:text-zinc-700 dark:hover:text-zinc-300">
          기본값으로 초기화
        </button>
      </form>

      <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
        <p className="mb-2 text-xs font-medium text-zinc-500">
          미리보기 (예시 값 기준{objectType === "feed" ? ", 저장 시점의 실제 형식으로 렌더링됨" : ""})
        </p>
        {objectType === "feed" ? (
          <div className="flex gap-3">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded bg-zinc-200 text-center text-[10px] leading-tight text-zinc-500 dark:bg-zinc-700 dark:text-zinc-400">
              상품
              <br />
              이미지
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">{truncateProductName(PREVIEW_VARS.productName)}</p>
              <p className="whitespace-pre-wrap text-xs text-zinc-500">{previewText}</p>
              <span className="mt-1 inline-block w-fit rounded border border-zinc-300 px-2 py-0.5 text-[11px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">
                상품 보기
              </span>
            </div>
          </div>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm">{previewText}</pre>
        )}
      </div>
    </div>
  );
}
