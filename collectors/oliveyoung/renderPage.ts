import { AsyncLocalStorage } from "node:async_hooks";
import { isBotChallengePage, type RenderedPage } from "./pageTypes";
import type { ServerlessRenderSession } from "./serverlessBrowserFetcher";

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
  const session = renderSessionStore.getStore();
  if (session) return session.fetch(url, timeoutMs);
  if (process.env.VERCEL) {
    const { fetchRenderedHtmlServerlessResilient } = await import("./serverlessBrowserFetcher");
    return fetchRenderedHtmlServerlessResilient(url, timeoutMs);
  }
  const { fetchRenderedHtmlResilient: fetchLocalResilient } = await import("./browserFetcher");
  return fetchLocalResilient(url, timeoutMs);
}

const renderSessionStore = new AsyncLocalStorage<ServerlessRenderSession>();

/**
 * Runs `fn` with one shared browser for every page it renders, so a cron
 * run or a search crawl launches Chromium once instead of once per product
 * (see createServerlessRenderSession). Any collector called inside `fn`
 * picks the session up automatically through AsyncLocalStorage; nothing
 * needs to be passed down.
 *
 * Only matters on Vercel. Locally, browserFetcher.ts already keeps one
 * browser alive for the whole process. Nested calls reuse the outer session.
 */
export async function withRenderSession<T>(fn: () => Promise<T>): Promise<T> {
  if (!process.env.VERCEL || renderSessionStore.getStore()) return fn();
  const { createServerlessRenderSession } = await import("./serverlessBrowserFetcher");
  const session = createServerlessRenderSession();
  try {
    return await renderSessionStore.run(session, fn);
  } finally {
    await session.close();
  }
}
