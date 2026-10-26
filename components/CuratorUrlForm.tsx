"use client";

import { useActionState } from "react";
import { setCuratorUrlAction, type CuratorUrlFormState } from "@/lib/actions/admin-actions";

const initialState: CuratorUrlFormState = {};

export function CuratorUrlForm({ productId, currentUrl }: { productId: string; currentUrl: string | null }) {
  const boundAction = setCuratorUrlAction.bind(null, productId);
  const [state, action, pending] = useActionState(boundAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="text-sm font-medium text-zinc-700 dark:text-zinc-300">큐레이터 URL (구매하기 이동 링크)</label>
      <div className="flex gap-2">
        <input
          type="url"
          name="curatorUrl"
          defaultValue={currentUrl ?? ""}
          placeholder="https://... (비워두면 올리브영 원본 상품 URL로 대체됩니다)"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          저장
        </button>
      </div>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && <p className="text-xs text-emerald-600">저장되었습니다.</p>}
    </form>
  );
}
