"use client";

import { useActionState } from "react";
import { deleteProductAction, type DeleteProductState } from "@/lib/actions/admin-actions";

const initialState: DeleteProductState = {};

export function DeleteProductButton({ productId, trackerCount }: { productId: string; trackerCount: number }) {
  const [state, action, pending] = useActionState(deleteProductAction.bind(null, productId), initialState);
  const warning =
    `상품 ${productId}을(를) 삭제할까요?\n\n가격 이력, 수집 기록, 알림이 함께 지워집니다.` +
    (trackerCount > 0 ? `\n추적 중인 사용자 ${trackerCount}명의 관심 상품에서도 사라집니다.` : "") +
    "\n되돌릴 수 없습니다.";

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (!window.confirm(warning)) e.preventDefault();
      }}
      className="flex flex-col gap-1"
    >
      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
      >
        {pending ? "삭제 중..." : "상품 삭제"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
