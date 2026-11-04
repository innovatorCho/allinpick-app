/**
 * Tests for the shared-browser render session
 * (collectors/oliveyoung/serverlessBrowserFetcher.ts createServerlessRenderSession)
 * with a fake browser, since the real serverless Chromium only runs on
 * Linux/Lambda. The fake reproduces the production failures:
 *  - 2026-11-03: concurrent launches racing ("spawn ETXTBSY").
 *  - 2026-11-04: two tabs at once in --single-process Chromium crash the
 *    browser, and a hung page held the cron run until the 300s kill.
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FakeBrowser {
  id: number;
  connected: boolean;
  closed: boolean;
  pagesOpened: number;
  openNow: number;
  maxOpenAtOnce: number;
}

interface FakeOptions {
  failFirstLaunch?: boolean;
  /** URLs whose page never finishes loading. */
  hangOn?: Set<string>;
  /** Crash the browser on the next newPage(). */
  crashNext?: { value: boolean };
}

/** Stand-in for playwright's Browser, behaving like single-process Chromium: a second open tab kills it. */
function fakeLauncher(opts: FakeOptions = {}) {
  const browsers: FakeBrowser[] = [];
  let launches = 0;
  const launch = async (): Promise<Browser> => {
    launches += 1;
    await sleep(20); // launching takes time, so concurrent callers overlap
    if (opts.failFirstLaunch && launches === 1) throw new Error("spawn ETXTBSY");
    const state: FakeBrowser = { id: launches, connected: true, closed: false, pagesOpened: 0, openNow: 0, maxOpenAtOnce: 0 };
    browsers.push(state);
    const dead = () => new Error("Target page, context or browser has been closed");
    const browser = {
      isConnected: () => state.connected,
      close: async () => {
        state.connected = false;
        state.closed = true;
      },
      newPage: async () => {
        if (!state.connected) throw dead();
        if (opts.crashNext?.value) {
          opts.crashNext.value = false;
          state.connected = false;
          throw dead();
        }
        state.openNow += 1;
        state.maxOpenAtOnce = Math.max(state.maxOpenAtOnce, state.openNow);
        if (state.openNow > 1) {
          state.connected = false; // single-process Chromium falls over
          throw new Error("net::ERR_INSUFFICIENT_RESOURCES");
        }
        state.pagesOpened += 1;
        return {
          goto: async (url: string) => {
            if (opts.hangOn?.has(url)) await new Promise(() => {}); // never resolves
            await sleep(15);
            if (!state.connected) throw dead();
            return { status: () => 200 };
          },
          waitForTimeout: async () => {},
          content: async () => `<html>browser ${state.id}</html>`,
          close: async () => {
            state.openNow -= 1;
          },
        };
      },
    };
    return browser as unknown as Browser;
  };
  return { launch, browsers, launchCount: () => launches };
}

async function main() {
  await test("concurrent fetches share one browser and render one page at a time", async () => {
    const fake = fakeLauncher();
    const session = createServerlessRenderSession(fake.launch);
    const pages = await Promise.all(["a", "b", "c", "d"].map((u) => session.fetch(`https://x/${u}`)));
    assert.equal(fake.launchCount(), 1);
    assert.equal(fake.browsers[0].pagesOpened, 4);
    assert.equal(fake.browsers[0].maxOpenAtOnce, 1, "never two tabs at once (single-process Chromium)");
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
    const crashNext = { value: false };
    const fake = fakeLauncher({ crashNext });
    const session = createServerlessRenderSession(fake.launch);
    await session.fetch("https://x/1");
    crashNext.value = true;
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

  await test("a hung page hits the hard limit, its browser is closed, and the queue moves on", async () => {
    const fake = fakeLauncher({ hangOn: new Set(["https://x/stuck"]) });
    const session = createServerlessRenderSession(fake.launch, { fetchHardTimeoutMs: 200 });
    const started = Date.now();
    const results = await Promise.allSettled([
      session.fetch("https://x/stuck"),
      session.fetch("https://x/after-1"),
      session.fetch("https://x/after-2"),
    ]);
    const elapsed = Date.now() - started;

    assert.equal(results[0].status, "rejected");
    assert.match(String((results[0] as PromiseRejectedResult).reason), /초 안에 끝나지 않아/);
    assert.equal(results[1].status, "fulfilled");
    assert.equal(results[2].status, "fulfilled");
    assert.ok(elapsed < 1000, `queue kept moving (took ${elapsed}ms)`);
    assert.equal(fake.browsers[0].closed, true, "the hung browser was closed");
    assert.equal(fake.launchCount(), 2, "exactly one fresh browser for the rest, no stray relaunch");
    assert.ok(fake.browsers.every((b) => b.maxOpenAtOnce <= 1));
    await session.close();
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
