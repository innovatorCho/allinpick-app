import { isBotChallengePage, type RenderedPage } from "./pageTypes";

export { isBotChallengePage };
export type { RenderedPage };

/**
 * Picks the Chromium launch strategy for wherever this process is actually
 * running — the one place that decision gets made. productCollector.ts and
 * searchCollector.ts import from here, never from browserFetcher.ts or
 * serverlessBrowserFetcher.ts directly, so the two environments can't
 * silently drift back out of sync with each other.
 *
 *  - On Vercel (`process.env.VERCEL` is set in every Vercel deployment,
 *    including Preview — Vercel's own documented env var; also true for a
 *    local `vercel dev`) → @sparticuz/chromium + playwright-core
 *    (serverlessBrowserFetcher.ts), the only combination whose binary
 *    actually runs in that Lambda-based runtime. Verified via Docker before
 *    this was wired in for real (see chat history / Dockerfile.serverless-test).
 *  - Everywhere else (local `next dev`, Docker test images that aren't
 *    emulating Vercel itself) → plain `playwright`'s own managed Chromium
 *    (browserFetcher.ts) — what's actually installed locally, and
 *    @sparticuz/chromium's binary doesn't execute there anyway (confirmed:
 *    `spawn ENOEXEC` on macOS).
 */
//
// Both fetchers are loaded lazily (dynamic import) so that merely importing
// a collector never loads a browser package. Pages like /search import the
// crawler chain at module level; a browser package that fails to load must
// only fail the crawl itself (which callers already turn into a
// NETWORK_ERROR result), never the whole page with a 500.
export async function fetchRenderedHtmlResilient(url: string, timeoutMs?: number): Promise<RenderedPage> {
  if (process.env.VERCEL) {
    const { fetchRenderedHtmlServerlessResilient } = await import("./serverlessBrowserFetcher");
    return fetchRenderedHtmlServerlessResilient(url, timeoutMs);
  }
  const { fetchRenderedHtmlResilient: fetchLocalResilient } = await import("./browserFetcher");
  return fetchLocalResilient(url, timeoutMs);
}
