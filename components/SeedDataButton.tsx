import { generateSampleDataAction } from "@/lib/actions/admin-actions";
import { SubmitButton } from "./SubmitButton";

/** Dev-only control (AGENTS.md §16) — the page only renders this outside production. */
export function SeedDataButton() {
  return (
    <form action={generateSampleDataAction}>
      <SubmitButton
        pendingText="생성 중..."
        className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        테스트 데이터 생성
      </SubmitButton>
    </form>
  );
}
