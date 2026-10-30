"use client";

import Link from "next/link";

/**
 * Shown to shoppers when a page or Server Action fails on the server.
 * Never renders error.message: the real cause is recorded in the admin
 * error log (instrumentation.ts onRequestError → /admin/errors). The digest
 * is a short opaque hash, safe to show, and lets an admin find the matching
 * log entry if a user reports it.
 */
export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-lg font-semibold">잠시 문제가 생겼어요</h1>
      <p className="break-keep text-sm text-zinc-500">
        일시적인 오류로 화면을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => retry()}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          다시 시도
        </button>
        <Link
          href="/"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          홈으로
        </Link>
      </div>
      {error.digest && <p className="text-xs text-zinc-400">오류 코드: {error.digest}</p>}
    </div>
  );
}
