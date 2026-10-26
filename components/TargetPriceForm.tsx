"use client";

import { useActionState } from "react";
import { setTargetPriceAction, type TargetPriceFormState } from "@/lib/actions/tracking-actions";

const initialState: TargetPriceFormState = {};

export function TargetPriceForm({
  productId,
  currentTargetPrice,
}: {
  productId: string;
  currentTargetPrice: number | null;
}) {
  const boundAction = setTargetPriceAction.bind(null, productId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <input
          type="number"
          name="targetPrice"
          min={1}
          defaultValue={currentTargetPrice ?? undefined}
          placeholder="목표 가격"
          className="w-32 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          알림 설정
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-600">목표 가격이 설정되었습니다.</p>}
    </form>
  );
}
