import { trackProductAction, untrackProductAction } from "@/lib/actions/tracking-actions";
import { SubmitButton } from "./SubmitButton";

/** Plain progressive-enhancement form — no client JS required to track/untrack. */
export function TrackButton({ productId, isTracking }: { productId: string; isTracking: boolean }) {
  if (isTracking) {
    return (
      <form action={untrackProductAction.bind(null, productId)}>
        <SubmitButton
          pendingText="처리 중..."
          className="w-full rounded-lg border border-zinc-900 bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
        >
          추적 중 (해제하기)
        </SubmitButton>
      </form>
    );
  }

  return (
    <form action={trackProductAction.bind(null, productId)}>
      <SubmitButton
        pendingText="처리 중..."
        className="w-full rounded-lg border border-zinc-900 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-900 hover:text-white disabled:opacity-50 dark:border-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
      >
        가격 추적하기
      </SubmitButton>
    </form>
  );
}
