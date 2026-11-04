import { chromium, type Browser } from "playwright-core";
import sparticuzChromium from "@sparticuz/chromium";
import { isBotChallengePage, type RenderedPage } from "./pageTypes";

export type { RenderedPage };
export { isBotChallengePage };

/**
 * Serverless-sized alternate to browserFetcher.ts — built to answer one
 * question before committing to a Vercel migration: does a serverless-sized
 * Chromium (`@sparticuz/chromium`, the binary used on AWS Lambda/Vercel
 * Functions) still get past oliveyoung.co.kr's Cloudflare challenge the same
 * way a normal Playwright-managed Chromium does? (Verified via Docker: yes.)
 *
 * Now wired into the real collection path too — see renderPage.ts, which
 * picks this over browserFetcher.ts whenever `process.env.VERCEL` is set.
 * Also still reachable standalone via the admin "서버리스 크롤러 테스트"
 * tool for isolated smoke-testing. Two behavioral differences from
 * browserFetcher.ts, both intentional and both matching what a real Vercel
 * Function invocation actually looks like:
 *
 * 1. No cached/reused browser (browserFetcher.ts keeps one warm on
 *    `globalThis` for the process's lifetime). Every call here launches a
 *    fresh browser and closes it when done — a serverless invocation never
 *    gets to reuse a warm browser from a previous one, so measuring "cold
 *    start every time" is the whole point of this test, not an oversight.
 * 2. `@sparticuz/chromium`'s binary targets Lambda's Amazon-Linux-based
 *    runtime (the same model Vercel Functions run on) — it will NOT execute
 *    on a developer's own macOS/Windows machine. Running this test locally
 *    is expected to fail at the "launch the browser" step with an exec
 *    error; a real answer requires either Docker (an amazonlinux-based
 *    image) or an actual Vercel deployment. That failure mode itself is
 *    useful information, not a bug in this file.
 */

/**
 * `executablePath()` unpacks the compressed Chromium binary into /tmp. Two
 * concurrent calls in the same instance race: one is still writing
 * /tmp/chromium while the other tries to run it, and the launch fails with
 * "spawn ETXTBSY" (seen in production on 2026-11-03 with scheduler
 * concurrency 2). Unpacking once per instance and sharing the promise
 * removes the race. A failed unpack is forgotten so the next call retries.
 */
let executablePathPromise: Promise<string> | null = null;

function getExecutablePath(): Promise<string> {
  if (!executablePathPromise) {
    executablePathPromise = sparticuzChromium.executablePath().catch((err: unknown) => {
      executablePathPromise = null;
      throw err;
    });
  }
  return executablePathPromise;
}

async function launchServerlessBrowser(): Promise<Browser> {
  const executablePath = await getExecutablePath();
  return chromium.launch({
    args: sparticuzChromium.args,
    executablePath,
    headless: true,
    // Playwright's default is 3 minutes; a launch that hangs that long
    // would eat most of a cron run's time budget.
    timeout: 30_000,
  });
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function renderWithBrowser(browser: Browser, url: string, timeoutMs: number): Promise<RenderedPage> {
  const page = await browser.newPage({ userAgent: USER_AGENT });
  try {
    // "networkidle" stopped working entirely — matches browserFetcher.ts's
    // finding: OliveYoung's page keeps some background connection open
    // permanently, so the network never goes fully idle and this never
    // resolves regardless of timeout. Switched to "domcontentloaded".
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // Longer than browserFetcher.ts's 1s — confirmed empirically (Docker/Amazon
    // Linux test) that OliveYoung's eg:* meta tags land ~2s AFTER domcontentloaded
    // in this environment, later than they do with a plain local Playwright
    // Chromium. 1s wasn't enough and produced false PARSER_ERROR results.
    await page.waitForTimeout(3000);
    const html = await page.content();
    return { html, status: response?.status() ?? null };
  } finally {
    await page.close();
  }
}

export async function fetchRenderedHtmlServerless(url: string, timeoutMs = 20_000): Promise<RenderedPage> {
  const browser = await launchServerlessBrowser();
  try {
    return await renderWithBrowser(browser, url, timeoutMs);
  } finally {
    await browser.close();
  }
}

/**
 * Same resilient-retry behavior as fetchRenderedHtmlResilient, but the retry
 * reuses the SAME browser instance (just a new page) — within one real
 * serverless invocation, a retry wouldn't pay the cold-start cost twice,
 * only the very first attempt of a fresh invocation does.
 */
export async function fetchRenderedHtmlServerlessResilient(url: string, timeoutMs = 20_000): Promise<RenderedPage> {
  const browser = await launchServerlessBrowser();
  try {
    const first = await renderWithBrowser(browser, url, timeoutMs);
    if (!isBotChallengePage(first.html)) return first;

    await new Promise((resolve) => setTimeout(resolve, 2000));
    return await renderWithBrowser(browser, url, timeoutMs);
  } finally {
    await browser.close();
  }
}

/**
 * One browser shared by every page rendered during a session (one cron run,
 * one search crawl). Launching Chromium costs seconds and a few hundred MB,
 * so doing it once per run instead of once per product is what lets a whole
 * cycle fit in the function's time limit.
 *
 * Pages are rendered ONE AT A TIME. @sparticuz/chromium runs Chromium with
 * --single-process, and two tabs open at once in that mode crashed the
 * browser in production (2026-11-04: "browser has been closed" followed by
 * net::ERR_INSUFFICIENT_RESOURCES). Callers may still call fetch()
 * concurrently; calls simply queue.
 *
 * Every fetch has a hard time limit covering launch, navigation and retry.
 * When it's hit, the browser is closed (a hung single-process browser can't
 * be trusted) and the next fetch launches a fresh one. Without this, one
 * stuck page held the whole cron run until the platform killed it at 300s.
 *
 * The browser launches lazily on the first fetch (a run with nothing due
 * never starts one), and a crashed browser is replaced on the next fetch.
 */
export interface ServerlessRenderSession {
  fetch(url: string, timeoutMs?: number): Promise<RenderedPage>;
  close(): Promise<void>;
}

/** Upper bound for one fetch: launch (≤30s, usually a few) + page (20s) + a bot-check retry, trimmed. */
export const SESSION_FETCH_HARD_TIMEOUT_MS = 55_000;

export function createServerlessRenderSession(
  /** Overridable only for tests (scripts/verify/test-render-session.ts). */
  launch: () => Promise<Browser> = launchServerlessBrowser,
  options: { fetchHardTimeoutMs?: number } = {}
): ServerlessRenderSession {
  const hardTimeoutMs = options.fetchHardTimeoutMs ?? SESSION_FETCH_HARD_TIMEOUT_MS;
  let browserPromise: Promise<Browser> | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  /** Bumped whenever the browser is force-closed; work from an older generation must not relaunch. */
  let generation = 0;

  async function getBrowser(): Promise<Browser> {
    if (browserPromise) {
      const browser = await browserPromise.catch(() => null);
      if (browser?.isConnected()) return browser;
      browserPromise = null;
    }
    browserPromise = launch();
    return browserPromise;
  }

  async function discardBrowser(): Promise<void> {
    generation += 1;
    const pending = browserPromise;
    browserPromise = null;
    const browser = pending ? await pending.catch(() => null) : null;
    await browser?.close().catch(() => {});
  }

  async function renderResilient(url: string, timeoutMs: number): Promise<RenderedPage> {
    const browser = await getBrowser();
    const first = await renderWithBrowser(browser, url, timeoutMs);
    if (!isBotChallengePage(first.html)) return first;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    return renderWithBrowser(browser, url, timeoutMs);
  }

  async function renderOnce(url: string, timeoutMs: number): Promise<RenderedPage> {
    const startedIn = generation;
    try {
      return await renderResilient(url, timeoutMs);
    } catch (err) {
      // Browser died under us (crash, failed launch): one retry on a fresh
      // browser. Any other failure (page timeout, HTTP error) is the page's
      // problem and is reported as-is.
      // Abandoned by the hard limit while running: don't launch a second
      // browser alongside the one the next queued fetch is using.
      if (startedIn !== generation) throw err;
      const browser = browserPromise ? await browserPromise.catch(() => null) : null;
      if (browser && browser.isConnected()) throw err;
      browserPromise = null;
      return renderResilient(url, timeoutMs);
    }
  }

  async function renderWithHardLimit(url: string, timeoutMs: number): Promise<RenderedPage> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = renderOnce(url, timeoutMs);
    work.catch(() => {}); // if the limit wins, this rejection must not go unhandled
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`페이지 처리가 ${Math.round(hardTimeoutMs / 1000)}초 안에 끝나지 않아 중단했습니다.`)),
        hardTimeoutMs
      );
    });
    try {
      return await Promise.race([work, limit]);
    } catch (err) {
      if (err instanceof Error && err.message.includes("안에 끝나지 않아")) await discardBrowser();
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    fetch(url, timeoutMs = 20_000) {
      const result = queue.then(() => renderWithHardLimit(url, timeoutMs));
      queue = result.catch(() => {});
      return result;
    },
    async close() {
      await queue;
      await discardBrowser();
    },
  };
}
