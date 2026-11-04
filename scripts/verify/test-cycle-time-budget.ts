/**
 * Tests for the price-collection cycle's time budget and stale-cycle guard
 * (lib/priceScheduler.ts runOneCycle options.stopStartingAt, STALE_CYCLE_MS).
 * Both exist because a Vercel cron run that hit the function's time limit
 * used to be killed mid-way with nothing saved, and could leave the
 * "in progress" flag stuck on a reused instance.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-cycle-budget.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-cycle-time-budget.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { updateSchedulingMeta, listDueTrackedProducts } from "@/lib/domain/products";
import { runOneCycle, getSchedulerStatus, updateSchedulerConfig } from "@/lib/priceScheduler";
import { ensureUsersSeeded } from "@/lib/domain/users";
import type { CollectResult } from "@/collectors/oliveyoung/types";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
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

/** Succeeds after `delayMs`, like a real page render that takes a while. */
function slowCollector(delayMs: number, calls: string[]): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const id = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "";
    calls.push(id);
    await sleep(delayMs);
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      data: { oliveyoungProductId: id, name: `상품 ${id}`, brand: "테스트", imageUrl: null, normalPrice: 10000, salePrice: 10000, discountRate: 0 },
    };
  };
}

async function makeDue(ids: string[]) {
  const now = Date.now();
  for (const [i, id] of ids.entries()) {
    await updateSchedulingMeta(id, {
      // Distinct, ordered due times so "oldest first" is observable.
      nextCheckAt: new Date(now - (ids.length - i) * 60_000).toISOString(),
      consecutiveFailures: 0,
      consecutiveSameCount: 0,
    });
  }
}

async function main() {
  await ensureUsersSeeded();
  const ids = ["TB0001", "TB0002", "TB0003", "TB0004", "TB0005", "TB0006"];
  const instant = slowCollector(0, []);
  for (const id of ids) {
    await registerProductForUser(`https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`, "user-a", instant);
  }
  assert.deepEqual(await updateSchedulerConfig({ concurrency: 2, enabled: true }), {});

  await test("stops starting new products at the cutoff, saves finished ones, leaves the rest due", async () => {
    await makeDue(ids);
    const calls: string[] = [];
    // 2 workers, 300ms per product, cutoff at 450ms:
    // t=0 starts 2, t=300 starts 2 more, t=600 is past the cutoff → stop.
    await runOneCycle(slowCollector(300, calls), { stopStartingAt: Date.now() + 450 });

    assert.equal(calls.length, 4, `expected 4 started, got ${calls.join(",")}`);
    assert.deepEqual(calls, ids.slice(0, 4), "oldest-due products go first");

    const status = await getSchedulerStatus();
    assert.equal(status.cycleInProgress, false);
    assert.equal(status.lastRunResults.length, 4);
    assert.ok(status.lastRunResults.every((r) => r.status === "SUCCESS"));

    const stillDue = (await listDueTrackedProducts(new Date().toISOString())).map((p) => p.id).sort();
    assert.deepEqual(stillDue, ["TB0005", "TB0006"], "unstarted products stay due for the next run");
  });

  await test("the next run picks up exactly the leftovers", async () => {
    const calls: string[] = [];
    await runOneCycle(slowCollector(0, calls), { stopStartingAt: Date.now() + 60_000 });
    assert.deepEqual(calls.sort(), ["TB0005", "TB0006"]);
    assert.equal((await listDueTrackedProducts(new Date().toISOString())).length, 0);
  });

  await test("no cutoff given → processes everything (local dev, tests)", async () => {
    await makeDue(ids);
    const calls: string[] = [];
    await runOneCycle(slowCollector(0, calls));
    assert.equal(calls.length, ids.length);
  });

  await test("a recent in-progress cycle still blocks overlap", async () => {
    await makeDue(ids);
    const state = (globalThis as unknown as { __allinpickSchedulerState: { cycleInProgress: boolean; lastRunStartedAt: string | null } })
      .__allinpickSchedulerState;
    state.cycleInProgress = true;
    state.lastRunStartedAt = new Date(Date.now() - 60_000).toISOString();
    const calls: string[] = [];
    await runOneCycle(slowCollector(0, calls));
    assert.equal(calls.length, 0);
    state.cycleInProgress = false;
  });

  await test("a cycle stuck 'in progress' for over 10 minutes is treated as dead", async () => {
    const state = (globalThis as unknown as { __allinpickSchedulerState: { cycleInProgress: boolean; lastRunStartedAt: string | null } })
      .__allinpickSchedulerState;
    state.cycleInProgress = true;
    state.lastRunStartedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    const calls: string[] = [];
    await runOneCycle(slowCollector(0, calls));
    assert.equal(calls.length, ids.length);
    assert.equal((await getSchedulerStatus()).cycleInProgress, false);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
