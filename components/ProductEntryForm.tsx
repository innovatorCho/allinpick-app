"use client";

import { useActionState, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { registerProductAction, type RegisterFormState } from "@/lib/actions/product-actions";
import { ActionErrorModal } from "./MessageModal";

// OliveYoung's share sheet copies "[올리브영] 상품명 https://oy.run/..." — a link anywhere in the text counts.
const LINK_IN_TEXT = /https?:\/\/\S+|oliveyoung\.co\.kr|oy\.run/i;

const initialState: RegisterFormState = {};

/**
 * The home page's one input: a pasted OliveYoung link registers the product
 * for price alerts, anything else searches the products already registered.
 * The button says which of the two will happen.
 */
export function ProductEntryForm({ help }: { help: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [state, action, pending] = useActionState(registerProductAction, initialState);
  const isLink = LINK_IN_TEXT.test(value);
  const isEmpty = value.trim() === "";

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    if (isLink) return; // registerProductAction runs
    event.preventDefault();
    const query = value.trim();
    router.push(query ? `/search?q=${encodeURIComponent(query)}` : "/search");
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <input
          type="text"
          name="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="상품 링크 붙여넣기 · 상품명 검색"
          aria-label="올리브영 상품 링크 또는 검색어"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={pending || isEmpty}
          className={`shrink-0 whitespace-nowrap rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 ${
            isLink || isEmpty
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          }`}
        >
          {/* Empty shows the main feature; typing a word switches it to search. */}
          {pending ? "등록 중..." : isLink || isEmpty ? "🔔 알림 받기" : "🔍 검색"}
        </button>
      </div>
      <ActionErrorModal state={state} />
      {help && <p className="whitespace-pre-line break-keep text-xs leading-relaxed text-zinc-500">{help}</p>}
    </form>
  );
}
