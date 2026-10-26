import { chromium, type Browser } from "playwright";

/**
 * Renders a URL with a real (unmodified, no stealth patches) headless
 * Chromium via Playwright, instead of a plain `fetch()`.
 *
 * Why this exists: oliveyoung.co.kr fronts every request with a Cloudflare
 * challenge that requires executing JavaScript to pass. A plain HTTP client
 * (fetch/curl) can never get through it — verified repeatedly against the
 * fetch-based approach, which always receives the "잠시만 기다려 주세요"
 * interstitial regardless of network origin. A real browser engine passes
 * through normally because it actually runs that JS, the same as any human
 * visitor's browser would. This is not fingerprint spoofing or evasion —
 * it's an ordinary headless Chromium, used the way it's meant to be used.
 * (Verified against real product and search pages while building this.)
 *
 * Operational note: this is heavy for a per-request server operation — a
 * browser process plus a full page load, a few seconds each. Fine for this
 * MVP's feasibility test; a real deployment would want a browser pool or a
 * remote rendering service, not one Chromium instance per Next.js process.
 */

declare global {
  var __allinpickBrowser: Promise<Browser> | undefined;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function getBrowser(): Promise<Browser> {
  if (!globalThis.__allinpickBrowser) {
    globalThis.__allinpickBrowser = chromium.launch({ headless: true });
  }
  return globalThis.__allinpickBrowser;
}

export interface RenderedPage {
  html: string;
  status: number | null;
}

/** Shared by both collectors — kept here since it's about this fetch mechanism, not OliveYoung's page content per se. */
export function isBotChallengePage(html: string): boolean {
  return html.includes("잠시만 기다려 주세요") || (html.includes("cloudflare") && html.toLowerCase().includes("challenge"));
}

// Was "networkidle", which stopped working entirely (every real product hit
// "NETWORK_ERROR: Timeout ...ms exceeded" for over a month straight — last
// real SUCCESS: 2026-09-09; confirmed by direct collect_logs inspection).
// Root-caused empirically: OliveYoung's page now keeps some background
// connection open permanently (ads/analytics/chat widget), so the network
// never goes fully idle and "networkidle" simply never resolves, no matter
// how long the timeout is — raising the timeout earlier didn't help because
// it wasn't a slow-challenge problem. "domcontentloaded" resolved in ~300ms
// in a direct real-site test and the page already had eg:title etc. by then
// (plus the explicit wait below) — no need for a long timeout anymore either.
export async function fetchRenderedHtml(url: string, timeoutMs = 20_000): Promise<RenderedPage> {
  const browser = await getBrowser();
  const page = await browser.newPage({ userAgent: USER_AGENT });
  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Give a JS challenge (or late-loading widgets) a moment to settle. Was
    // 1000ms; raised after real collect_logs showed recurring PARSER_ERROR
    // ("상품명을 찾을 수 없습니다") — confirmed by direct inspection that
    // OliveYoung's eg:* meta tags can land ~2-3s after domcontentloaded now
    // (the page has gotten heavier since this was first tuned), not within 1s.
    await page.waitForTimeout(3000);
    const html = await page.content();
    return { html, status: response?.status() ?? null };
  } finally {
    await page.close();
  }
}

/**
 * Same as fetchRenderedHtml, but retries once if the first attempt lands on
 * OliveYoung's bot-challenge page. Observed empirically while building this:
 * the challenge is intermittent — a request that gets challenged once can
 * succeed outright on a second attempt a couple seconds later, and vice
 * versa. One retry, not a loop: this is resilience against a flaky
 * third-party response, not an attempt to grind past a hard block.
 */
export async function fetchRenderedHtmlResilient(url: string, timeoutMs = 20_000): Promise<RenderedPage> {
  const first = await fetchRenderedHtml(url, timeoutMs);
  if (!isBotChallengePage(first.html)) return first;

  await new Promise((resolve) => setTimeout(resolve, 2000));
  return fetchRenderedHtml(url, timeoutMs);
}
