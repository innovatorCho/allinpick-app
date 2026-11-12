"use client";

import { useActionState } from "react";
import { registerProductAction, type RegisterFormState } from "@/lib/actions/product-actions";
import { ActionErrorModal } from "./MessageModal";

const initialState: RegisterFormState = {};

export function RegisterProductForm({ defaultUrl }: { defaultUrl?: string } = {}) {
  const [state, action, pending] = useActionState(registerProductAction, initialState);

  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          name="url"
          required
          defaultValue={defaultUrl}
          placeholder="올리브영 상품 링크를 붙여넣으세요"
          className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "확인 중..." : "가격 알림 받기"}
        </button>
      </div>
      <ActionErrorModal state={state} />
    </form>
  );
}
