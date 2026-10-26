import { NextResponse, type NextRequest } from "next/server";
import { runDigestCheck } from "@/lib/digestScheduler";
import { isCronRequestAuthorized } from "@/lib/cronAuth";

/**
 * Triggers one daily-digest check (lib/digestScheduler.ts's runDigestCheck) —
 * cheap and idempotent to call repeatedly; it only actually sends once the
 * Asia/Seoul digest window has opened AND a user hasn't already gotten
 * today's digest. See lib/priceScheduler.ts / app/api/cron/collect-prices for
 * why this moved out of an in-process timer, and lib/cronAuth.ts for who's
 * allowed to call this (Vercel Cron, an external pinger, or local dev's
 * self-ping).
 */
export const maxDuration = 30;

export async function GET(request: NextRequest): Promise<NextResponse> {
  if (!isCronRequestAuthorized(request)) {
    return NextResponse.json({ error: "인증 실패 — secret이 올바르지 않습니다." }, { status: 401 });
  }

  await runDigestCheck();
  return NextResponse.json({ ok: true });
}
