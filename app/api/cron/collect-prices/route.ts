import { NextResponse, type NextRequest } from "next/server";
import { runOneCycle, getSchedulerStatus } from "@/lib/priceScheduler";
import { isCronRequestAuthorized } from "@/lib/cronAuth";

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
 * Hobby plan's max maxDuration — a full cycle (multiple real browser-based
 * collections) can comfortably exceed the 10s default.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "인증 실패 — secret이 올바르지 않습니다." }, { status: 401 });
  }

  await runOneCycle();
  const status = await getSchedulerStatus();
  return NextResponse.json({
    lastRunStartedAt: status.lastRunStartedAt,
    lastRunFinishedAt: status.lastRunFinishedAt,
    lastRunDurationMs: status.lastRunDurationMs,
    results: status.lastRunResults,
  });
}
