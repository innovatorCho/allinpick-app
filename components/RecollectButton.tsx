import { recollectProductAction } from "@/lib/actions/admin-actions";
import { SubmitButton } from "./SubmitButton";

export function RecollectButton({ productId }: { productId: string }) {
  return (
    <form action={recollectProductAction.bind(null, productId)}>
      <SubmitButton
        pendingText="가격 확인 중... (최대 10초 정도 걸릴 수 있습니다)"
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        가격 다시 확인
      </SubmitButton>
    </form>
  );
}
