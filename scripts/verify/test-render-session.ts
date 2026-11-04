/**
 * Tests for the shared-browser render session
 * (collectors/oliveyoung/serverlessBrowserFetcher.ts createServerlessRenderSession)
 * with a fake browser, since the real serverless Chromium only runs on
 * Linux/Lambda. Covers the 2026-11-03 production failure: concurrent
 * launches racing ("spawn ETXTBSY") and a browser dying mid-run.
 *
 * Run with:
 *   node --experimental-strip-types --import ./scripts/verify/register.mjs scripts/verify/test-render-session.ts
 */
import assert from "node:assert/strict";
import type { Browser } from "playwright-core";

import { createServerlessRenderSession } from "@/collectors/oliveyoung/serverlessBrowserFetcher";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

interface FakeBrowser {
  id: number;
  connected: boolean;
  closed: boolean;
  pagesOpened: number;
  /** When set, newPage() kills this browser and throws, like a Chromium crash. */
  crashOnNextPage: boolean;
}

/** Minimal stand-in for playwright's Browser: just what renderWithBrowser touches. */
function fakeLauncher(opts: { failFirstLaunch?: boolean } = {}) {
  const browsers: FakeBrowser[] = [];
  let launches = 0;
  const launch = async (): Promise<Browser> => {
    launches += 1;
    await new Promise((r) => setTimeout(r, 20)); // launching takes time, so concurrent callers overlap
    if (opts.failFirstLaunch && launches === 1) throw new Error("spawn ETXTBSY");
    const state: FakeBrowser = { id: launches, connected: true, closed: false, pagesOpened: 0, crashOnNextPage: false };
    browsers.push(state);
    const browser = {
      isConnected: () => state.connected,
      close: async () => {
        state.connected = false;
        state.closed = true;
      },
      newPage: async () => {
        if (state.crashOnNextPage) {
          state.crashOnNextPage = false;
          state.connected = false;
          throw new Error("browser.newPage: Target page, context or browser has been closed");
        }
        state.pagesOpened += 1;
        return {
          goto: async () => ({ status: () => 200 }),
          waitForTimeout: async () => {},
          content: async () => `<html>browser ${state.id}</html>`,
          close: async () => {},
        };
      },
    };
    return browser as unknown as Browser;
  };
  return { launch, browsers, launchCount: () => launches };
}

async function main() {
  await test("concurrent fetches share one browser launch", async () => {
    const fake = fakeLauncher();
    const session = createServerlessRenderSession(fake.launch);
    const pages = await Promise.all(["a", "b", "c", "d"].map((u) => session.fetch(`https://x/${u}`)));
    assert.equal(fake.launchCount(), 1);
    assert.equal(fake.browsers[0].pagesOpened, 4);
    assert.ok(pages.every((p) => p.html.includes("browser 1") && p.status === 200));
    await session.close();
    assert.equal(fake.browsers[0].closed, true);
  });

  await test("no fetch → no browser is ever launched", async () => {
    const fake = fakeLauncher();
    const session = createServerlessRenderSession(fake.launch);
    await session.close();
    assert.equal(fake.launchCount(), 0);
  });

  await test("a browser that crashes mid-run is replaced; later fetches keep working", async () => {
    const fake = fakeLauncher();
    const session = createServerlessRenderSession(fake.launch);
    await session.fetch("https://x/1");
    fake.browsers[0].crashOnNextPage = true;
    const page = await session.fetch("https://x/2");
    assert.equal(fake.launchCount(), 2);
    assert.match(page.html, /browser 2/);
    assert.match((await session.fetch("https://x/3")).html, /browser 2/, "no further relaunch needed");
    await session.close();
    assert.equal(fake.browsers[1].closed, true);
  });

  await test("a failed launch is retried once instead of failing the product", async () => {
    const fake = fakeLauncher({ failFirstLaunch: true });
    const session = createServerlessRenderSession(fake.launch);
    const page = await session.fetch("https://x/1");
    assert.equal(fake.launchCount(), 2);
    assert.match(page.html, /browser 2/);
    await session.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
