"use client";

import { useActionState } from "react";
import { updateSchedulerConfigAction, type SchedulerConfigFormState } from "@/lib/actions/admin-actions";

const initialState: SchedulerConfigFormState = {};

export function SchedulerConfigForm({
  currentIntervalMinutes,
  currentConcurrency,
  minIntervalMinutes,
  maxConcurrency,
}: {
  currentIntervalMinutes: number;
  currentConcurrency: number;
  minIntervalMinutes: number;
  maxConcurrency: number;
}) {
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
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-600">설정이 저장되었습니다.</p>}
    </form>
  );
}
