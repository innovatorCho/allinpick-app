import { NextResponse, type NextRequest } from "next/server";
import { runOneCycle, getSchedulerStatus, CYCLE_START_CUTOFF_MARGIN_MS } from "@/lib/priceScheduler";
import { isCronRequestAuthorized } from "@/lib/cronAuth";
import { runLog, runWarn, seconds } from "@/lib/runLog";

/**
 * Triggers one price-recollection cycle (lib/priceScheduler.ts's runOneCycle).
 * Replaces the old in-process `setInterval` — see that file's module doc
 * comment for why. Called by:
 *  - Vercel Cron (vercel.json) — once a day on Hobby, as often as configured on Pro+.
 *  - An external pinger (cron-job.org, GitHub Actions, ...) for Hobby-plan
 *    users who want the real ~30min cadence price accuracy actually needs.
 *  - instrumentation.ts's local-dev self-ping.
 * See lib/cronAuth.ts for the shared-secret check all three use.
 *
 * maxDuration is in seconds. 300 is the maximum on Vercel's Hobby plan with
 * Fluid compute (enabled on this project; 60s only applies without it). A
 * cycle renders each due product in a real browser, a few seconds each.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const received = Date.now();
  const caller = request.headers.get("user-agent")?.startsWith("vercel-cron") ? "Vercel Cron" : "외부 호출";
  if (!isCronRequestAuthorized(request)) {
    runWarn(`요청 거부 (${caller}): CRON_SECRET이 없거나 일치하지 않습니다.`, "collect-api");
    return NextResponse.json({ error: "인증 실패 — secret이 올바르지 않습니다." }, { status: 401 });
  }
  runLog(`요청 받음 (${caller}) · 실행 제한 ${maxDuration}초`, "collect-api");

  // Stop starting new products early enough that in-flight ones finish and
  // get saved before the platform kills the function.
  await runOneCycle(undefined, { stopStartingAt: Date.now() + maxDuration * 1000 - CYCLE_START_CUTOFF_MARGIN_MS });
  const status = await getSchedulerStatus();
  runLog(`응답 보냄 · 총 ${seconds(Date.now() - received)}`, "collect-api");
  return NextResponse.json({
    lastRunStartedAt: status.lastRunStartedAt,
    lastRunFinishedAt: status.lastRunFinishedAt,
    lastRunDurationMs: status.lastRunDurationMs,
    results: status.lastRunResults,
  });
}
