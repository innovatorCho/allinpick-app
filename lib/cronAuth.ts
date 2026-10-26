import type { NextRequest } from "next/server";

/**
 * Shared-secret check for app/api/cron/*.ts — those routes replace the old
 * in-process setInterval timers (lib/priceScheduler.ts / lib/digestScheduler.ts
 * used to self-schedule; see chat history for why that doesn't survive
 * Vercel's serverless functions) and must now be triggered from outside:
 *
 *  - Vercel's own Cron Jobs (vercel.json) — Vercel automatically sends
 *    `Authorization: Bearer $CRON_SECRET` on every request it makes to a
 *    cron-configured route when that env var is set. Accepted below.
 *  - A free external pinger (cron-job.org, a GitHub Actions scheduled
 *    workflow, etc.) for anyone on Vercel's Hobby plan, where Vercel's own
 *    cron is capped at once a day — too infrequent for real price-accuracy
 *    needs. Can't always set a custom header, so a `?secret=` query param
 *    is accepted too.
 *  - This app's own local-dev self-ping (instrumentation.ts) — not on
 *    Vercel, so Vercel Cron doesn't exist there either; same `?secret=`
 *    mechanism, using a fixed dev-only fallback so local dev works with
 *    zero extra setup.
 */

const DEV_FALLBACK_SECRET = "local-dev-cron-secret"; // never used when NODE_ENV=production or on Vercel — see below

/**
 * `next start` locally (e.g. our own Docker build-smoke-test) also sets
 * NODE_ENV=production despite not being Vercel — treated the same as real
 * production here: no dev fallback secret, and instrumentation.ts's
 * self-ping (which only ever sends the dev fallback) skips itself too, so
 * the two always agree instead of self-ping sending a secret this check
 * would then reject.
 */
function isProdLikeEnvironment(): boolean {
  return process.env.NODE_ENV === "production" || !!process.env.VERCEL;
}

export function isCronRequestAuthorized(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET ?? (isProdLikeEnvironment() ? null : DEV_FALLBACK_SECRET);
  if (!expected) return false; // production/Vercel with no CRON_SECRET set → fail closed, always

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${expected}`) return true; // Vercel Cron's own mechanism

  return request.nextUrl.searchParams.get("secret") === expected; // external pinger / local self-ping
}

/** instrumentation.ts calls this to decide whether to self-ping at all — see isProdLikeEnvironment's doc comment. */
export function shouldSelfPingCronRoutes(): boolean {
  return !isProdLikeEnvironment();
}

/** What instrumentation.ts's local self-ping and any external pinger should actually send. */
export function getCronSecretForSelfPing(): string {
  return process.env.CRON_SECRET ?? DEV_FALLBACK_SECRET;
}
