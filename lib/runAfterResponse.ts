import { after } from "next/server";

/**
 * Runs `task` once the current request's response has actually been sent —
 * via Next.js's `after()`. On Vercel this is backed by their own
 * `waitUntil`, which keeps the serverless invocation alive until `task`
 * settles — without it, work started but not awaited before the response
 * returns is NOT guaranteed to finish (the function can freeze/exit right
 * after responding). See lib/kakaoMessaging.ts (fire-and-forget Kakao sends)
 * and lib/priceScheduler.ts (admin "지금 실행") for why that guarantee matters.
 *
 * `after()` throws when called outside an active Next.js request context —
 * true for every scripts/verify/*.ts script, which import these same domain
 * functions as plain Node scripts with no Next.js request machinery at all
 * (confirmed: throws "called outside a request scope", see
 * node_modules/next/dist/server/after/after.js). Falls back to the old bare
 * detached-promise behavior there, so tests keep working unchanged; inside
 * the real app (Server Actions, Route Handlers) this branch is never taken.
 */
export function runAfterResponse(task: () => Promise<void>): void {
  try {
    after(task);
  } catch {
    void task();
  }
}
