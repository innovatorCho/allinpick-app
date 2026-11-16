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
import { updateSchedulingMeta, getProductById, listDueTrackedProducts } from "@/lib/domain/products";
import { endBotBlockWaitNow, getBotBlockCooldown, startBotBlockCooldown } from "@/lib/domain/botBlockCooldown";
import { runOneCycle, getSchedulerStatus, updateSchedulerConfig } from "@/lib/priceScheduler";
import { ensureUsersSeeded } from "@/lib/domain/users";
import { getDb } from "@/lib/db/client";
import { saveWorkerStatus, shouldCollectInline, type CycleProgress } from "@/lib/domain/workerStatus";
import { queueProductForUser } from "@/lib/domain/collection";
import { isQuietHour } from "@/lib/domain/schedulerSettings";
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

/** Records every requested goodsNo; those in `blockedIds` come back BOT_BLOCKED. */
function recording(calls: string[], blockedIds: Set<string>): Collector {
  const inner = stubWithBlocks(blockedIds);
  return async (sourceUrl) => {
    calls.push(sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "");
    return inner(sourceUrl);
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

  await test("차단으로 중단되면 전체 요청 대기(1단계, 30분)가 시작되고, 시도 못 한 상품은 그대로 대기 상태", async () => {
    const cooldown = await getBotBlockCooldown();
    assert.ok(cooldown, "대기가 시작돼야 함");
    assert.equal(cooldown!.level, 1);
    const minutes = (new Date(cooldown!.until).getTime() - Date.now()) / 60_000;
    assert.ok(minutes > 29 && minutes <= 30, `1단계는 30분이어야 함 (실제 ${minutes.toFixed(1)}분)`);

    const [p4, p5] = await Promise.all([getProductById("CB0004"), getProductById("CB0005")]);
    assert.equal(p4!.consecutiveFailures, 0, "시도하지 않았으니 실패 카운트가 올라가면 안 됨");
    assert.equal(p5!.consecutiveFailures, 0);
    const dueIds = (await listDueTrackedProducts(new Date().toISOString())).map((p) => p.id);
    assert.ok(dueIds.includes("CB0004") && dueIds.includes("CB0005"), "뒤로 밀리지 않고 대기 상태로 남아야 함");
  });

  await test("차단당한 상품(CB0002/0003)은 실패 벌점 없이 대기 상태로 남음 — 차단은 상품이 아니라 접속 전체 문제", async () => {
    const [p2, p3] = await Promise.all([getProductById("CB0002"), getProductById("CB0003")]);
    assert.equal(p2!.consecutiveFailures, 0);
    assert.equal(p3!.consecutiveFailures, 0);
    assert.equal(p2!.lastCollectStatus, "BOT_BLOCKED", "마지막 상태는 기록돼야 함");
    const dueIds = (await listDueTrackedProducts(new Date().toISOString())).map((p) => p.id);
    assert.ok(dueIds.includes("CB0002") && dueIds.includes("CB0003"));
  });

  await test("대기 중에는 아무 요청도 보내지 않음", async () => {
    const calls: string[] = [];
    assert.equal(await runOneCycle(recording(calls, new Set())), null);
    assert.deepEqual(calls, []);
  });

  await test("대기가 끝나면 상품 1개로만 확인하고, 또 차단이면 다음 단계(60분)로 늘어남", async () => {
    await endBotBlockWaitNow();
    const calls: string[] = [];
    await runOneCycle(recording(calls, new Set(["CB0002", "CB0003", "CB0004", "CB0005"])));
    assert.equal(calls.length, 1, "확인용 요청은 1개만");
    const cooldown = await getBotBlockCooldown();
    assert.equal(cooldown!.level, 2);
    const minutes = (new Date(cooldown!.until).getTime() - Date.now()) / 60_000;
    assert.ok(minutes > 59 && minutes <= 60, `2단계는 60분이어야 함 (실제 ${minutes.toFixed(1)}분)`);
  });

  await test("단계는 30분 → 1시간 → 2시간 → 4시간 → 6시간, 이후 6시간 유지", async () => {
    const minutesAt = async () => (new Date((await getBotBlockCooldown())!.until).getTime() - Date.now()) / 60_000;
    for (const expected of [120, 240, 360, 360]) {
      await startBotBlockCooldown();
      const minutes = await minutesAt();
      assert.ok(minutes > expected - 1 && minutes <= expected, `${expected}분이어야 함 (실제 ${minutes.toFixed(1)}분)`);
    }
  });

  await test("확인 요청이 성공하면 대기가 풀리고, 다음 실행은 남은 상품을 모두 처리", async () => {
    await endBotBlockWaitNow();
    const probeCalls: string[] = [];
    await runOneCycle(recording(probeCalls, new Set()));
    assert.equal(probeCalls.length, 1);
    assert.equal(await getBotBlockCooldown(), null, "차단이 풀렸으면 대기 기록이 지워져야 함");

    const calls: string[] = [];
    await runOneCycle(recording(calls, new Set()));
    assert.deepEqual(calls.sort(), ["CB0002", "CB0003", "CB0004", "CB0005"].filter((id) => !probeCalls.includes(id)));
  });

  await test("확인 요청이 차단 외의 이유로 실패해도(페이지 해석 실패 등) 접속은 된 것이므로 대기가 풀림", async () => {
    await startBotBlockCooldown();
    await endBotBlockWaitNow();
    await registerDue("CB0201", 60, now, stubSuccess("CB0201"));
    const parserError: Collector = async (sourceUrl) => ({
      status: "PARSER_ERROR",
      sourceUrl,
      error: "상품명을 찾을 수 없습니다.",
      checkedAt: new Date().toISOString(),
    });
    await runOneCycle(parserError);
    assert.equal(await getBotBlockCooldown(), null);
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
    assert.equal(await getBotBlockCooldown(), null, "1건으로는 대기가 시작되지 않음");
  });

  await test("차단 대기 상태를 DB에서 못 읽으면(연결 오류) 수집하지 않고 건너뜀 — '대기 없음'으로 보고 전부 요청하면 안 됨", async () => {
    await startBotBlockCooldown();
    await endBotBlockWaitNow(); // 확인 차례: 원래라면 상품 1개만 요청해야 하는 상태
    await registerDue("CB0201", 50, now, stubSuccess("CB0201"));
    await registerDue("CB0202", 40, now, stubSuccess("CB0202"));

    await getDb();
    const client = globalThis.__allinpickDbClient!;
    const original = client.execute.bind(client);
    // Only the cooldown read fails, like the real blip where the product query right after it succeeded.
    client.execute = (async (stmt: { sql: string; args?: unknown[] }) => {
      if (Array.isArray(stmt.args) && stmt.args.includes("collect.botBlockCooldown") && stmt.sql.startsWith("SELECT")) {
        throw new Error("fetch failed");
      }
      return original(stmt as unknown as Parameters<typeof original>[0]);
    }) as typeof client.execute;
    const calls: string[] = [];
    try {
      assert.equal(await runOneCycle(recording(calls, new Set())), null);
    } finally {
      client.execute = original;
    }
    assert.deepEqual(calls, [], "어떤 상품도 요청하지 않아야 함");
    assert.ok(await getBotBlockCooldown(), "대기 상태도 그대로 남아야 함");
  });

  await test("수집 중 진행 상황(전체/완료/성공/실패)을 시작과 상품마다 알려주고, 끝나면 상태에서 지움", async () => {
    await updateSchedulerConfig({ concurrency: 1 });
    // 앞 테스트의 대기를 풀고 시작 (확인 요청 1개 성공 → 해제)
    await endBotBlockWaitNow();
    await runOneCycle(stubWithBlocks(new Set()));
    assert.equal(await getBotBlockCooldown(), null);
    // 앞 테스트들이 남긴 대기 상품을 먼저 모두 처리해서, 아래 실행은 새로 넣은 3개만 대상이 되게 함
    await runOneCycle(stubWithBlocks(new Set()));
    assert.equal((await listDueTrackedProducts(new Date().toISOString())).length, 0);

    await registerDue("CB0301", 50, now, stubSuccess("CB0301"));
    await registerDue("CB0302", 40, now, stubSuccess("CB0302"));
    await registerDue("CB0303", 30, now, stubSuccess("CB0303"));
    const seen: CycleProgress[] = [];
    await runOneCycle(stubWithBlocks(new Set(["CB0302"])), { onProgress: (p) => seen.push({ ...p }) });
    assert.deepEqual(
      seen.map((p) => [p.done, p.succeeded, p.failed]),
      [[0, 0, 0], [1, 1, 0], [2, 1, 1], [3, 2, 1]]
    );
    assert.ok(seen.every((p) => p.total === 3 && !p.probing));
    assert.equal((await getSchedulerStatus()).progress, null, "끝나면 진행 중 표시가 없어야 함");
  });

  await test("확인할 상품이 없으면 진행 상황을 알리지 않음 (대기 중에 '수집 중'으로 보이면 안 됨)", async () => {
    // 앞 테스트에서 차단된 CB0302는 벌점 없이 대기로 남으므로 먼저 처리
    await runOneCycle(stubWithBlocks(new Set()));
    const seen: CycleProgress[] = [];
    await runOneCycle(stubWithBlocks(new Set()), { onProgress: (p) => seen.push(p), quietWhenIdle: true });
    assert.equal(seen.length, 0);
  });

  const kstHour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  const pacing = (gap: number, quiet: [number, number]) => ({
    requestGapMinSec: gap,
    requestGapMaxSec: gap,
    quietStartHour: quiet[0],
    quietEndHour: quiet[1],
  });
  const noQuiet: [number, number] = [0, 0];

  await test("쉬는 시간 판정: 자정을 넘는 구간(23~6시)도 맞고, 시작=끝이면 꺼짐", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 0, 1, (h + 15) % 24)); // KST = UTC+9
    assert.equal(isQuietHour({ quietStartHour: 2, quietEndHour: 7 }, at(3)), true);
    assert.equal(isQuietHour({ quietStartHour: 2, quietEndHour: 7 }, at(7)), false);
    assert.equal(isQuietHour({ quietStartHour: 23, quietEndHour: 6 }, at(0)), true);
    assert.equal(isQuietHour({ quietStartHour: 23, quietEndHour: 6 }, at(12)), false);
    assert.equal(isQuietHour({ quietStartHour: 4, quietEndHour: 4 }, at(4)), false);
  });

  await test("잘못된 요청 간격·쉬는 시간은 거부", async () => {
    assert.ok((await updateSchedulerConfig({ pacing: pacing(-1, noQuiet) })).error);
    assert.ok((await updateSchedulerConfig({ pacing: { ...pacing(10, noQuiet), requestGapMinSec: 30 } })).error, "최소 > 최대");
    assert.ok((await updateSchedulerConfig({ pacing: pacing(0, [24, 3]) })).error);
  });

  await test("수집 프로그램 실행 중: 프로그램은 상품 사이 간격을 두고 하나씩 수집", async () => {
    await updateSchedulerConfig({ concurrency: 3, pacing: pacing(1, noQuiet) });
    await registerDue("CB0401", 50, now, stubSuccess("CB0401"));
    await registerDue("CB0402", 40, now, stubSuccess("CB0402"));
    await registerDue("CB0403", 30, now, stubSuccess("CB0403"));
    const startedAt: number[] = [];
    const timed: Collector = async (url) => {
      startedAt.push(Date.now());
      return stubWithBlocks(new Set())(url);
    };
    await runOneCycle(timed, { asWorker: true });
    assert.equal(startedAt.length, 3);
    for (let i = 1; i < startedAt.length; i++) {
      assert.ok(startedAt[i] - startedAt[i - 1] >= 950, `요청 사이 간격 ${startedAt[i] - startedAt[i - 1]}ms (1초 이상이어야 함)`);
    }
  });

  await test("쉬는 시간엔 수집 프로그램이 아직 정보가 없는 새 상품만 수집", async () => {
    await updateSchedulerConfig({ pacing: pacing(0, [kstHour, (kstHour + 1) % 24]) });
    await registerDue("CB0501", 50, now, stubSuccess("CB0501")); // 정보 있음 → 쉬는 시간엔 건너뜀
    await queueProductForUser("https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=CB0502", "user-a"); // 새 상품
    const calls: string[] = [];
    await runOneCycle(recording(calls, new Set()), { asWorker: true });
    assert.deepEqual(calls, ["CB0502"]);
    await updateSchedulerConfig({ pacing: pacing(0, noQuiet) });
    calls.length = 0;
    await runOneCycle(recording(calls, new Set()), { asWorker: true });
    assert.deepEqual(calls, ["CB0501"], "쉬는 시간이 끝나면 나머지도 수집");
  });

  await test("수집 프로그램이 켜져 있으면 다른 곳(로컬 서버 자동 실행 등)은 수집하지 않음 — 두 곳에서 동시에 요청하지 않게", async () => {
    await registerDue("CB0601", 50, now, stubSuccess("CB0601"));
    const at = new Date().toISOString();
    await saveWorkerStatus({ host: "test", startedAt: at, lastPollAt: at, cycleStartedAt: null, progress: null, stoppedAt: null, lastRun: null });
    const calls: string[] = [];
    assert.equal(await runOneCycle(recording(calls, new Set())), null);
    assert.deepEqual(calls, []);
    assert.equal(await shouldCollectInline(), false, "등록·가격 다시 확인도 바로 수집하지 않고 프로그램에 맡김");

    await runOneCycle(recording(calls, new Set()), { asWorker: true });
    assert.deepEqual(calls, ["CB0601"], "수집 프로그램 자신은 수집");

    await saveWorkerStatus({ host: "test", startedAt: at, lastPollAt: at, cycleStartedAt: null, progress: null, stoppedAt: at, lastRun: null });
    assert.equal(await shouldCollectInline(), true, "프로그램이 꺼지면 이 서버가 다시 직접 수집");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
