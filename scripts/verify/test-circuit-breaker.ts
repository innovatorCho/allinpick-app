/**
 * Unit tests for the Cloudflare-block circuit breaker in lib/priceScheduler.ts —
 * added after a real, observed failure mode: forcing a burst of due products
 * got this app's IP blocked by Cloudflare for a sustained window, and the
 * scheduler kept burning through the rest of that tick's queue while already
 * blocked (see chat history). Network is never touched here — a stub
 * Collector simulates BOT_BLOCKED results deterministically.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-circuit-breaker.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-circuit-breaker.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { updateSchedulingMeta, getProductById } from "@/lib/domain/products";
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

function stubSuccess(id: string): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status: "SUCCESS",
    sourceUrl,
    checkedAt: new Date().toISOString(),
    data: {
      oliveyoungProductId: id,
      name: `서킷브레이커테스트 상품 ${id}`,
      brand: "테스트",
      imageUrl: null,
      normalPrice: 10000,
      salePrice: 10000,
      discountRate: 0,
    },
  });
}

/** blockedIds가 요청한 상품이면 BOT_BLOCKED, 아니면 성공으로 응답하는 스텁. */
function stubWithBlocks(blockedIds: Set<string>): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const id = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "";
    const checkedAt = new Date().toISOString();
    if (blockedIds.has(id)) {
      return { status: "BOT_BLOCKED", sourceUrl, error: "테스트: Cloudflare 차단 시뮬레이션", checkedAt };
    }
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt,
      data: { oliveyoungProductId: id, name: `상품 ${id}`, brand: "테스트", imageUrl: null, normalPrice: 10000, salePrice: 10000, discountRate: 0 },
    };
  };
}

async function registerDue(id: string, minutesAgo: number, now: Date, collector: Collector) {
  const url = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`;
  await registerProductForUser(url, "user-a", collector);
  await updateSchedulingMeta(id, {
    nextCheckAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
    consecutiveFailures: 0,
    consecutiveSameCount: 0,
  });
}

async function main() {
  await ensureUsersSeeded();
  // 동시처리를 1로 고정 — mapWithConcurrency의 워커 1개만 돌면 처리 순서가
  // next_check_at 오름차순 그대로 결정적이 되어, "몇 번째부터 끊기는지"를
  // 명확하게 검증할 수 있음(동시처리 2+면 어느 게 먼저 끝날지 레이스가 생김).
  await updateSchedulerConfig({ concurrency: 1 });

  const now = new Date("2026-01-01T00:00:00.000Z");

  await test("BOT_BLOCKED 2건(threshold) 도달 시 나머지는 시도조차 안 되고, 시도된 것만 결과에 남음", async () => {
    // 등록 순서(=next_check_at 오름차순): CB0001(성공) → CB0002(차단) → CB0003(차단) → CB0004(성공) → CB0005(성공)
    await registerDue("CB0001", 50, now, stubSuccess("CB0001"));
    await registerDue("CB0002", 40, now, stubSuccess("CB0002"));
    await registerDue("CB0003", 30, now, stubSuccess("CB0003"));
    await registerDue("CB0004", 20, now, stubSuccess("CB0004"));
    await registerDue("CB0005", 10, now, stubSuccess("CB0005"));

    const blocked = new Set(["CB0002", "CB0003"]);
    await runOneCycle(stubWithBlocks(blocked));

    const status = await getSchedulerStatus();
    const processedIds = status.lastRunResults.map((r) => r.productId);
    assert.deepEqual(
      processedIds,
      ["CB0001", "CB0002", "CB0003"],
      "threshold(2건) 도달 직후 중단되어 CB0004/CB0005는 시도조차 안 되어야 함"
    );
    assert.equal(status.lastRunResults[0].status, "SUCCESS");
    assert.equal(status.lastRunResults[1].status, "BOT_BLOCKED");
    assert.equal(status.lastRunResults[2].status, "BOT_BLOCKED");
  });

  await test("시도조차 못 한 상품은 next_check_at이 쿨다운만큼 뒤로 밀리고, consecutiveFailures는 그대로(시도 안 했으니)", async () => {
    const [p4, p5] = await Promise.all([getProductById("CB0004"), getProductById("CB0005")]);
    assert.ok(p4 && p5);

    const minutesFromNow = (iso: string) => (new Date(iso).getTime() - Date.now()) / 60_000;
    assert.ok(minutesFromNow(p4!.nextCheckAt!) > 15, "최소 15분 이상 뒤로 밀려야 함(쿨다운 20분)");
    assert.ok(minutesFromNow(p4!.nextCheckAt!) < 25, "쿨다운이 과도하게 길어지면 안 됨");
    assert.equal(p4!.consecutiveFailures, 0, "실제로 시도하지 않았으니 실패 카운트가 올라가면 안 됨");
    assert.equal(p5!.consecutiveFailures, 0);
  });

  await test("실제로 차단당한 상품은(CB0002/0003) 일반 실패와 동일하게 백오프가 걸림(consecutiveFailures=1)", async () => {
    const [p2, p3] = await Promise.all([getProductById("CB0002"), getProductById("CB0003")]);
    assert.equal(p2!.consecutiveFailures, 1);
    assert.equal(p3!.consecutiveFailures, 1);
  });

  await test("BOT_BLOCKED이 threshold 미만(1건)이면 서킷이 끊기지 않고 전부 처리됨", async () => {
    await registerDue("CB0101", 50, now, stubSuccess("CB0101"));
    await registerDue("CB0102", 40, now, stubSuccess("CB0102"));
    await registerDue("CB0103", 30, now, stubSuccess("CB0103"));

    const blocked = new Set(["CB0102"]); // 1건만 차단 — threshold(2) 미만
    await runOneCycle(stubWithBlocks(blocked));

    const status = await getSchedulerStatus();
    const processedIds = status.lastRunResults.map((r) => r.productId);
    assert.deepEqual(processedIds, ["CB0101", "CB0102", "CB0103"], "threshold 미만이면 전부 끝까지 처리되어야 함");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
