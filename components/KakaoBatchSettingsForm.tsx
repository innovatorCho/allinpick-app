"use client";

import { useActionState } from "react";
import { saveKakaoBatchSettingsAction, type KakaoBatchFormState } from "@/lib/actions/admin-actions";
import type { BatchSettingSource } from "@/lib/domain/kakaoBatchSettings";

const SOURCE_LABEL: Record<BatchSettingSource, string> = {
  admin: "관리자 설정값 사용 중",
  env: "환경변수 값 사용 중",
  default: "기본값 사용 중",
};

const initialState: KakaoBatchFormState = {};

export function KakaoBatchSettingsForm({
  adminValues,
  effective,
  sources,
  placeholders,
}: {
  /** Only what an admin saved; empty inputs mean "use env/default". */
  adminValues: { windowMinutes: string; summaryTitleTemplate: string; summaryTemplate: string };
  effective: { windowMinutes: number; summaryTitleTemplate: string; summaryTemplate: string };
  sources: {
    windowMinutes: BatchSettingSource;
    summaryTitleTemplate: BatchSettingSource;
    summaryTemplate: BatchSettingSource;
  };
  placeholders: string[];
}) {
  const [state, action, pending] = useActionState(saveKakaoBatchSettingsAction, initialState);
  const inputClass =
    "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";

  return (
    <form action={action} className="flex flex-col gap-4 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="windowMinutes" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            발송 간격 (분)
          </label>
          <span className="text-xs text-zinc-400">{SOURCE_LABEL[sources.windowMinutes]}</span>
        </div>
        <input
          id="windowMinutes"
          name="windowMinutes"
          type="number"
          min={0}
          max={1440}
          defaultValue={state.values?.windowMinutes ?? adminValues.windowMinutes}
          placeholder={sources.windowMinutes === "admin" ? "" : String(effective.windowMinutes)}
          className={inputClass}
        />
        <p className="break-keep text-xs text-zinc-500">
          한 사용자에게 카카오 알림을 이 간격에 최대 한 번만 보내요. 그사이 생긴 알림은 모았다가 다음 발송 때 한 번에
          보내요. 0이면 수집할 때마다 바로 보내요. 비워두면 환경변수 <code className="font-mono">KAKAO_BATCH_WINDOW_MINUTES</code>{" "}
          또는 기본값을 사용해요.
        </p>
      </div>

      <p className="break-keep text-xs text-zinc-500">
        모아서 보낼 상품이 2개 이상이면 가장 많이 내린 상품을 대표로, 큰 사진 아래에 아래 제목과 본문을 보여줘요. 그
        아래에는 이전 가격·현재 가격·내린 금액·할인율 표가 자동으로 붙고, &quot;이 상품 보기&quot;와 &quot;N개 모두
        보기&quot;(웹 알림 목록) 버튼이 달려요. 카카오톡은 제목과 본문을 합쳐 4줄 정도만 보여주니 짧게 써주세요. 쓸 수
        있는 항목:{" "}
        {placeholders.map((p) => (
          <code key={p} className="mr-1 font-mono">
            {`{${p}}`}
          </code>
        ))}
        ({"{topLowestNote}"}는 추적 시작 이후 최저가일 때만 &quot;🏆 추적 시작 이후 최저가예요!&quot;로 바뀌고, 아니면
        빈칸이에요.)
      </p>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="summaryTitleTemplate" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            여러 상품 요약 제목
          </label>
          <span className="text-xs text-zinc-400">{SOURCE_LABEL[sources.summaryTitleTemplate]}</span>
        </div>
        <input
          id="summaryTitleTemplate"
          name="summaryTitleTemplate"
          type="text"
          maxLength={60}
          defaultValue={state.values?.summaryTitleTemplate ?? adminValues.summaryTitleTemplate}
          placeholder={sources.summaryTitleTemplate === "admin" ? "" : effective.summaryTitleTemplate}
          className={inputClass}
        />
        <p className="break-keep text-xs text-zinc-500">
          비워두면 환경변수 <code className="font-mono">KAKAO_SUMMARY_TITLE_TEMPLATE</code> 또는 기본값을 사용해요.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="summaryTemplate" className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
            여러 상품 요약 본문
          </label>
          <span className="text-xs text-zinc-400">{SOURCE_LABEL[sources.summaryTemplate]}</span>
        </div>
        <textarea
          id="summaryTemplate"
          name="summaryTemplate"
          rows={3}
          maxLength={400}
          defaultValue={state.values?.summaryTemplate ?? adminValues.summaryTemplate}
          placeholder={sources.summaryTemplate === "admin" ? "" : effective.summaryTemplate}
          className={inputClass}
        />
        <p className="break-keep text-xs text-zinc-500">
          비워두면 환경변수 <code className="font-mono">KAKAO_SUMMARY_TEMPLATE</code> 또는 기본값을 사용해요.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {pending ? "저장 중..." : "저장"}
        </button>
        {state.error && <p className="text-sm text-red-600">{state.error}</p>}
        {!state.error && state.savedAt && !pending && <p className="text-sm text-emerald-600">저장했어요. 다음 발송부터 적용돼요.</p>}
      </div>
    </form>
  );
}
