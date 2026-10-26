"use client";

import { useActionState, useState } from "react";
import { createTestNotificationAction, type TestNotificationFormState } from "@/lib/actions/admin-actions";
import type { AppUser } from "@/lib/domain/types";
import type { Product } from "@/lib/domain/types";

const initialState: TestNotificationFormState = {};

export function NotificationTestForm({ users, products }: { users: AppUser[]; products: Product[] }) {
  const [state, action, pending] = useActionState(createTestNotificationAction, initialState);

  // 이전/현재 가격 입력칸 — 상품을 고르면 그 상품의 실제 정상가/판매가로 채워주고,
  // 그 뒤엔 관리자가 자유롭게 값을 덮어써서 테스트할 수 있도록 controlled input으로 둠.
  const [oldPrice, setOldPrice] = useState("");
  const [newPrice, setNewPrice] = useState("");

  function handleProductChange(productId: string) {
    const product = products.find((p) => p.id === productId);
    setOldPrice(product?.normalPrice != null ? String(product.normalPrice) : "");
    setNewPrice(product?.salePrice != null ? String(product.salePrice) : "");
  }

  return (
    <form action={action} className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">받을 사용자</span>
          <select
            name="userId"
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">선택하세요</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
                {u.email ? ` (${u.email})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">대상 상품</span>
          <select
            name="productId"
            required
            onChange={(e) => handleProductChange(e.target.value)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="">선택하세요</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">알림 종류</span>
          <select
            name="type"
            required
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="price_drop">가격 하락</option>
            <option value="target_price">목표가 도달</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">이전 가격 (상품 선택 시 정상가로 자동 입력)</span>
            <input
              type="number"
              name="oldPrice"
              min={0}
              value={oldPrice}
              onChange={(e) => setOldPrice(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">현재 가격 (상품 선택 시 판매가로 자동 입력)</span>
            <input
              type="number"
              name="newPrice"
              min={0}
              value={newPrice}
              onChange={(e) => setNewPrice(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-zinc-600 dark:text-zinc-400">목표가 (선택, 목표가 알림의 카카오톡 템플릿 미리보기용)</span>
            <input
              type="number"
              name="targetPrice"
              min={0}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
        </div>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">메시지</span>
        <input
          type="text"
          name="message"
          required
          placeholder="예: 29,900원 → 26,900원, 3,000원 하락했습니다."
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>

      <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
        <input type="checkbox" name="sendKakao" className="h-4 w-4 rounded border-zinc-300 dark:border-zinc-700" />
        카카오톡으로도 보내기 (선택한 사용자가 카카오 로그인으로 talk_message 동의를 마쳤어야 실제로 도착합니다)
      </label>

      <button
        type="submit"
        disabled={pending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "생성 중..." : "테스트 알림 생성"}
      </button>
      {state.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state.success && (
        <p className="text-xs text-emerald-600">
          알림이 생성되었습니다. 아래 목록과 해당 사용자의 &quot;내 관심상품&quot; 화면에서 확인할 수 있습니다.
        </p>
      )}
    </form>
  );
}
