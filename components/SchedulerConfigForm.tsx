"use client";

import { useActionState } from "react";
import { updateSchedulerConfigAction, type SchedulerConfigFormState } from "@/lib/actions/admin-actions";
import type { PacingSettings } from "@/lib/domain/schedulerSettings";

const initialState: SchedulerConfigFormState = {};

export function SchedulerConfigForm({
  currentIntervalMinutes,
  currentConcurrency,
  minIntervalMinutes,
  maxConcurrency,
  pacing,
  maxGapSeconds,
}: {
  currentIntervalMinutes: number;
  currentConcurrency: number;
  minIntervalMinutes: number;
  maxConcurrency: number;
  pacing: PacingSettings;
  maxGapSeconds: number;
}) {
  const input =
    "w-20 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900";
  const [state, action, pending] = useActionState(updateSchedulerConfigAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">주기 (분, 최소 {minIntervalMinutes})</span>
          <input
            type="number"
            name="intervalMinutes"
            min={minIntervalMinutes}
            defaultValue={currentIntervalMinutes}
            className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">동시 처리 개수 (1~{maxConcurrency})</span>
          <input
            type="number"
            name="concurrency"
            min={1}
            max={maxConcurrency}
            defaultValue={currentConcurrency}
            className="w-28 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-zinc-600 dark:text-zinc-400">상품 사이 요청 간격 (초, 랜덤)</legend>
          <div className="flex items-center gap-1">
            <input type="number" name="gapMinSec" min={0} max={maxGapSeconds} defaultValue={pacing.requestGapMinSec} aria-label="최소 간격(초)" className={input} />
            <span>~</span>
            <input type="number" name="gapMaxSec" min={0} max={maxGapSeconds} defaultValue={pacing.requestGapMaxSec} aria-label="최대 간격(초)" className={input} />
          </div>
        </fieldset>
        <fieldset className="flex flex-col gap-1 text-sm">
          <legend className="mb-1 text-zinc-600 dark:text-zinc-400">쉬는 시간 (시, 한국 시간)</legend>
          <div className="flex items-center gap-1">
            <input type="number" name="quietStartHour" min={0} max={23} defaultValue={pacing.quietStartHour} aria-label="쉬는 시간 시작(시)" className={input} />
            <span>시 ~</span>
            <input type="number" name="quietEndHour" min={0} max={23} defaultValue={pacing.quietEndHour} aria-label="쉬는 시간 끝(시)" className={input} />
            <span>시</span>
          </div>
        </fieldset>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장
        </button>
      </div>
      <p className="text-xs leading-relaxed text-zinc-500">
        올리브영 차단을 피하려고 상품을 하나씩, 위 간격만큼 랜덤하게 쉬면서 확인합니다 (간격이 있으면 동시 처리 개수는
        1로 동작). 수집 프로그램이 꺼져 있어 로컬 서버가 대신 수집할 때도 똑같이 적용돼요. 쉬는 시간에는 아직 정보가 없는 새 상품만 수집합니다. 간격을 0~0으로 두면 쉬지 않고, 쉬는
        시간의 시작과 끝을 같게 두면 쉬는 시간이 꺼집니다.
      </p>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-600">설정이 저장되었습니다.</p>}
    </form>
  );
}
