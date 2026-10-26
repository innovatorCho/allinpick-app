/**
 * Unit tests for the per-product scheduling calculation (lib/domain/collectionSchedule.ts) —
 * the "diverse criteria" the scheduler uses to decide what to check and when.
 * Pure function, no DB/network involved.
 *
 * Run with:
 *   node --experimental-strip-types --import ./scripts/verify/register.mjs \
 *     scripts/verify/test-collection-schedule.ts
 */
import assert from "node:assert/strict";
import { computeNextSchedule } from "@/lib/domain/collectionSchedule";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

const BASE = 30 * 60 * 1000; // 30 minutes
const NOW = new Date("2026-01-01T00:00:00.000Z");

function minutesBetween(a: string, b: Date): number {
  return Math.round((new Date(a).getTime() - b.getTime()) / 60000);
}

test("실패하면 지수적으로 백오프하고 실패 횟수가 누적됨", () => {
  const first = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: null, priorConsecutiveFailures: 0, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.equal(first.consecutiveFailures, 1);
  assert.equal(minutesBetween(first.nextCheckAt, NOW), 60); // 30 * 2^1

  const third = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: null, priorConsecutiveFailures: 2, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.equal(third.consecutiveFailures, 3);
  assert.equal(minutesBetween(third.nextCheckAt, NOW), 30 * 2 ** 3);
});

test("실패 백오프는 24시간을 넘지 않음", () => {
  // base 60분 * 2^5(백오프 상한 스텝) = 32시간 → 24시간 캡에 걸려야 함.
  const result = computeNextSchedule(
    { baseIntervalMs: 60 * 60_000, trackerCount: 1, changeType: null, priorConsecutiveFailures: 20, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.equal(minutesBetween(result.nextCheckAt, NOW), 24 * 60);
});

test("성공하면 실패 카운트가 0으로 리셋됨", () => {
  const result = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "same", priorConsecutiveFailures: 4, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.equal(result.consecutiveFailures, 0);
});

test("가격이 실제로 변하면(하락/상승) 더 빨리 재확인하도록 간격이 짧아짐", () => {
  const result = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "decrease", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 5 },
    NOW
  );
  assert.ok(minutesBetween(result.nextCheckAt, NOW) < 30);
  assert.equal(result.consecutiveSameCount, 0, "가격이 변했으니 '변동 없음' 연속 횟수는 리셋되어야 함");
});

test("가격이 계속 그대로면(same 연속) 점점 간격이 늘어남", () => {
  const r1 = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "same", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 0 },
    NOW
  );
  const r2 = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "same", priorConsecutiveFailures: 0, priorConsecutiveSameCount: r1.consecutiveSameCount },
    NOW
  );
  const r3 = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "same", priorConsecutiveFailures: 0, priorConsecutiveSameCount: r2.consecutiveSameCount },
    NOW
  );
  const m1 = minutesBetween(r1.nextCheckAt, NOW);
  const m2 = minutesBetween(r2.nextCheckAt, NOW);
  const m3 = minutesBetween(r3.nextCheckAt, NOW);
  assert.ok(m1 < m2 && m2 < m3, `간격이 계속 늘어나야 함: ${m1} < ${m2} < ${m3}`);
});

test("추적자가 많은 인기 상품은 더 짧은 간격을 부여받음", () => {
  const unpopular = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "initial", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 0 },
    NOW
  );
  const popular = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 15, changeType: "initial", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.ok(minutesBetween(popular.nextCheckAt, NOW) < minutesBetween(unpopular.nextCheckAt, NOW));
});

test("간격은 상한/하한(0.5x~4x)을 벗어나지 않음", () => {
  const veryStable = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 1, changeType: "same", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 100 },
    NOW
  );
  assert.equal(minutesBetween(veryStable.nextCheckAt, NOW), 30 * 4);

  const veryPopularAndVolatile = computeNextSchedule(
    { baseIntervalMs: BASE, trackerCount: 100, changeType: "decrease", priorConsecutiveFailures: 0, priorConsecutiveSameCount: 0 },
    NOW
  );
  assert.equal(minutesBetween(veryPopularAndVolatile.nextCheckAt, NOW), 30 * 0.5);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
