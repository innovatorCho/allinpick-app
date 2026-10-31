"use client";

import { useActionState } from "react";
import { updateSiteSettingsAction, type SiteSettingsFormState } from "@/lib/actions/admin-actions";
import type { SiteSettingField, SiteSettingKey, SiteSettingSource } from "@/lib/domain/siteSettings";

const SOURCE_LABEL: Record<SiteSettingSource, string> = {
  admin: "관리자 설정값 사용 중",
  env: "환경변수 값 사용 중",
  default: "기본값 사용 중",
  none: "미입력",
};

const initialState: SiteSettingsFormState = {};

export function SiteSettingsForm({
  fields,
  adminValues,
  effectiveValues,
  sources,
}: {
  fields: SiteSettingField[];
  /** Only what an admin saved; empty inputs mean "use env/default". */
  adminValues: Partial<Record<SiteSettingKey, string>>;
  effectiveValues: Record<SiteSettingKey, string | null>;
  sources: Record<SiteSettingKey, SiteSettingSource>;
}) {
  const [state, action, pending] = useActionState(updateSiteSettingsAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-5">
      {fields.map((field) => {
        const source = sources[field.key];
        const inputClass =
          "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";
        // Placeholder shows what applies when the box is left empty.
        const fallback = source === "admin" ? null : effectiveValues[field.key];
        return (
          <div key={field.key} className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <label htmlFor={field.key} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {field.label}
                {field.required && <span className="ml-1 text-red-600">*</span>}
              </label>
              <span
                className={`text-xs ${
                  source === "none" && field.required ? "font-medium text-red-600" : "text-zinc-400"
                }`}
              >
                {SOURCE_LABEL[source]}
              </span>
            </div>
            {field.multiline ? (
              <textarea
                id={field.key}
                name={field.key}
                rows={3}
                maxLength={field.maxLength}
                defaultValue={state.values?.[field.key] ?? adminValues[field.key] ?? ""}
                placeholder={fallback ?? ""}
                className={inputClass}
              />
            ) : (
              <input
                id={field.key}
                name={field.key}
                type={field.type === "email" ? "email" : "text"}
                maxLength={field.maxLength}
                defaultValue={state.values?.[field.key] ?? adminValues[field.key] ?? ""}
                placeholder={fallback ?? ""}
                className={inputClass}
              />
            )}
            <p className="break-keep text-xs text-zinc-500">
              {field.help} 비워두면 환경변수 <code className="font-mono">{field.env}</code>
              {field.defaultValue ? " 또는 기본값" : ""}을 사용해요.
            </p>
          </div>
        );
      })}

      <div className="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "저장 중..." : "저장"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {!state.error && state.savedAt && !pending && <p className="text-sm text-emerald-600">저장했어요. 사이트에 바로 반영돼요.</p>}
      </div>
    </form>
  );
}
