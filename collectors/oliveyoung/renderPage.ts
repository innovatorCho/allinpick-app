import {
  fetchRenderedHtmlResilient as fetchLocalResilient,
  isBotChallengePage,
  type RenderedPage,
} from "./browserFetcher";
import { fetchRenderedHtmlServerlessResilient as fetchServerlessResilient } from "./serverlessBrowserFetcher";

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
export async function fetchRenderedHtmlResilient(url: string, timeoutMs?: number): Promise<RenderedPage> {
  if (process.env.VERCEL) return fetchServerlessResilient(url, timeoutMs);
  return fetchLocalResilient(url, timeoutMs);
}
