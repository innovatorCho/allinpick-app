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

async function launchServerlessBrowser(): Promise<Browser> {
  const executablePath = await sparticuzChromium.executablePath();
  return chromium.launch({
    args: sparticuzChromium.args,
    executablePath,
    headless: true,
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
