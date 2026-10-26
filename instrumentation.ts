import { getBaseUrl } from "@/lib/auth/providers";
import { getCronSecretForSelfPing, shouldSelfPingCronRoutes } from "@/lib/cronAuth";

/**
 * Next.js file convention: `register()` runs once when a server instance
 * starts (dev or prod), before it takes requests.
 *
 * Price re-collection and the daily Kakao digest (app/api/cron/collect-prices,
 * app/api/cron/digest) used to self-schedule via `setInterval` right here.
 * That assumed one long-running Node process and broke on Vercel's
 * serverless functions (an instance can freeze/recycle between requests, so
 * a timer set in one invocation isn't guaranteed to ever fire again) — see
 * lib/priceScheduler.ts's module doc comment. On Vercel, those two routes
 * are triggered externally instead (Vercel Cron via vercel.json, or an
 * external pinger for anyone on Hobby's once-a-day cron limit).
 *
 * Locally there's no Vercel Cron and usually no external pinger either, so
 * this keeps the old "just works automatically" dev experience by self-pinging
 * those same two routes over plain HTTP — which, unlike calling the scheduler
 * functions directly, goes through a real Next.js request each time. That
 * matters: lib/kakaoMessaging.ts's Kakao sends rely on `after()`, which
 * throws outside a request context (see lib/runAfterResponse.ts) — a bare
 * `setInterval` callback has no such context, an HTTP request to our own
 * route does.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NEXT_PHASE === "phase-production-build") return; // don't start a timer during `next build`
  if (!shouldSelfPingCronRoutes()) return; // production (incl. `next start` locally) / Vercel: Cron or an external pinger drives app/api/cron/* instead

  const baseUrl = getBaseUrl();
  const secret = getCronSecretForSelfPing();

  function ping(path: string): void {
    fetch(`${baseUrl}${path}?secret=${encodeURIComponent(secret)}`).catch((err) => {
      console.error(`[self-ping] ${path} 호출 실패 (서버가 아직 요청을 받을 준비가 안 됐을 수 있음):`, err instanceof Error ? err.message : err);
    });
  }

  const COLLECT_PRICES_INTERVAL_MS = 60_000; // 자주 찔러도 안전함 — runOneCycle은 실제로 처리할 게 없으면 바로 끝남
  const DIGEST_INTERVAL_MS = 5 * 60_000; // 21시(KST) 창이 열리면 늦지 않게 감지하면 충분, 더 잦을 필요 없음
  const INITIAL_DELAY_MS = 10_000; // let the server finish booting first

  setTimeout(() => {
    ping("/api/cron/collect-prices");
    ping("/api/cron/digest");
    setInterval(() => ping("/api/cron/collect-prices"), COLLECT_PRICES_INTERVAL_MS);
    setInterval(() => ping("/api/cron/digest"), DIGEST_INTERVAL_MS);
  }, INITIAL_DELAY_MS);

  console.log("[self-ping] 로컬 개발용 자동 핑 시작 (가격 재수집 1분마다, 다이제스트 5분마다 — app/api/cron/*)");
}
