import { withRenderSession } from "@/collectors/oliveyoung/renderPage";
import type { CollectResult } from "@/collectors/oliveyoung/types";
import { collectFailureCategory } from "@/lib/collectFailureCategory";
import { errorDetail, newRunId, resourceSnapshot, runLog, runWarn, seconds, withRunLog } from "@/lib/runLog";

/**
 * Wraps a one-off, user-triggered collection (product registration, admin
 * "가격 다시 확인") the same way the cron cycle is wrapped:
 *
 *  - progress logs with a run id, so Vercel's log viewer shows where it
 *    stopped (see lib/runLog.ts);
 *  - one shared browser session, which on Vercel also caps each page at
 *    55s. Before this, these paths launched a browser with no time limit,
 *    so a page that never loaded left the button spinning until the
 *    platform killed the request, with nothing recorded anywhere.
 */
export async function withLoggedCollection<T extends { collectResult: CollectResult }>(
  tag: string,
  description: string,
  fn: () => Promise<T>
): Promise<T> {
  return withRunLog(tag, newRunId(), async () => {
    const started = Date.now();
    runLog(`===== ${description} · 시작 · ${resourceSnapshot()} =====`);
    try {
      const result = await withRenderSession(fn);
      const r = result.collectResult;
      if (r.status === "SUCCESS") {
        runLog(`===== 종료 · ${seconds(Date.now() - started)} · 성공 · ${r.data.name} ${r.data.salePrice}원 =====`);
      } else {
        runWarn(
          `===== 종료 · ${seconds(Date.now() - started)} · 실패 · ${r.status} · 원인: ${collectFailureCategory(r.status, r.error)} =====\n` +
            errorDetail(r.error)
        );
      }
      return result;
    } catch (err) {
      runWarn(
        `===== 비정상 종료 · ${seconds(Date.now() - started)} =====\n` +
          errorDetail(err instanceof Error ? err.message : String(err))
      );
      throw err;
    }
  });
}
