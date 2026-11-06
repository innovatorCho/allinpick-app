/**
 * Whether this process opens OliveYoung pages itself.
 *
 * OliveYoung answers datacenter IPs with its bot check ("잠시만 기다려 주세요",
 * HTTP 403), and on Vercel every collection ended in a 55s timeout. So on
 * Vercel the site only records what to collect, and the collector worker
 * (scripts/worker.ts, run on a machine with a home connection) does the
 * actual collecting from the same database.
 *
 * `COLLECT_IN_APP=1` / `=0` overrides the default (off on Vercel, on
 * everywhere else), e.g. if Vercel collection is ever made to work again
 * through a proxy.
 */
export function canCollectHere(): boolean {
  const override = process.env.COLLECT_IN_APP?.trim();
  if (override === "1") return true;
  if (override === "0") return false;
  return !process.env.VERCEL;
}
