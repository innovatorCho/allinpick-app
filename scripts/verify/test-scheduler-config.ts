/**
 * Unit tests for the admin-configurable scheduler settings (lib/priceScheduler.ts).
 * The actual periodic cycle (real network collection) isn't stubbed here — it
 * was verified directly against the live dev server (see chat history); this
 * covers the validation/persistence logic an admin's form submission relies on.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify4.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-scheduler-config.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import {
  updateSchedulerConfig,
  getSchedulerStatus,
  MIN_INTERVAL_MS,
  MAX_CONCURRENCY,
} from "@/lib/priceScheduler";
import { getSetting } from "@/lib/domain/settings";

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

await test("최소 주기보다 짧은 값은 거부되고 상태가 바뀌지 않음", async () => {
  const before = (await getSchedulerStatus()).intervalMs;
  const result = await updateSchedulerConfig({ intervalMs: MIN_INTERVAL_MS - 1 });
  assert.ok(result.error);
  assert.equal((await getSchedulerStatus()).intervalMs, before);
});

await test("유효한 주기는 저장되고 DB에도 영속화됨", async () => {
  const tenMinutes = 10 * 60_000;
  const result = await updateSchedulerConfig({ intervalMs: tenMinutes });
  assert.equal(result.error, undefined);
  assert.equal((await getSchedulerStatus()).intervalMs, tenMinutes);
  assert.equal(await getSetting("scheduler_interval_ms"), String(tenMinutes));
});

await test("동시 처리 개수 범위를 벗어나면 거부", async () => {
  assert.ok((await updateSchedulerConfig({ concurrency: 0 })).error);
  assert.ok((await updateSchedulerConfig({ concurrency: MAX_CONCURRENCY + 1 })).error);
  assert.equal((await updateSchedulerConfig({ concurrency: MAX_CONCURRENCY })).error, undefined);
  assert.equal((await getSchedulerStatus()).concurrency, MAX_CONCURRENCY);
});

await test("일시정지/재개 토글이 반영되고 영속화됨", async () => {
  await updateSchedulerConfig({ enabled: false });
  assert.equal((await getSchedulerStatus()).enabled, false);
  assert.equal(await getSetting("scheduler_enabled"), "false");

  await updateSchedulerConfig({ enabled: true });
  assert.equal((await getSchedulerStatus()).enabled, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
