/**
 * Tests for collecting through the worker instead of the website
 * (lib/collectMode.ts, queueProductForUser, the worker's catch-up step).
 * On Vercel, OliveYoung's bot check made every collection time out, so the
 * site only queues products and scripts/worker.ts collects them.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-collect-queue.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-collect-queue.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { queueProductForUser, registerProductForUser, type Collector } from "@/lib/domain/collection";
import {
  getProductById,
  listDueTrackedProducts,
  listUncollectedTrackedProductIds,
  markDueNow,
} from "@/lib/domain/products";
import { getTracking } from "@/lib/domain/tracking";
import { runOneCycle } from "@/lib/priceScheduler";
import { canCollectHere } from "@/lib/collectMode";
import { isAwaitingFirstCollection } from "@/lib/collectStatusLabels";
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

const urlFor = (id: string) => `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`;

function collector(result: "SUCCESS" | "NETWORK_ERROR", calls: string[] = []): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const id = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "";
    calls.push(id);
    const checkedAt = new Date().toISOString();
    if (result === "NETWORK_ERROR") {
      return { status: "NETWORK_ERROR", sourceUrl, checkedAt, error: "페이지 처리가 55초 안에 끝나지 않아 중단했습니다." };
    }
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt,
      data: { oliveyoungProductId: id, name: `상품 ${id}`, brand: "테스트", imageUrl: null, normalPrice: 12000, salePrice: 9900, discountRate: 17 },
    };
  };
}

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

async function main() {
  await ensureUsersSeeded();

  await test("collects in the app locally, not on Vercel, and COLLECT_IN_APP overrides both", () => {
    withEnv({ VERCEL: undefined, COLLECT_IN_APP: undefined }, () => assert.equal(canCollectHere(), true));
    withEnv({ VERCEL: "1", COLLECT_IN_APP: undefined }, () => assert.equal(canCollectHere(), false));
    withEnv({ VERCEL: "1", COLLECT_IN_APP: "1" }, () => assert.equal(canCollectHere(), true));
    withEnv({ VERCEL: undefined, COLLECT_IN_APP: "0" }, () => assert.equal(canCollectHere(), false));
  });

  await test("queueing saves the product and the user's tracking without collecting, and it is due first", async () => {
    const product = await queueProductForUser(urlFor("Q0001"), "user-a");
    assert.equal(product.id, "Q0001");
    assert.ok(await getTracking("user-a", "Q0001"), "user should be tracking the product");
    const saved = (await getProductById("Q0001"))!;
    assert.equal(saved.lastCollectStatus, null, "nothing collected yet");
    assert.equal(isAwaitingFirstCollection(saved), true);
    const due = await listDueTrackedProducts(new Date().toISOString());
    assert.equal(due[0]?.id, "Q0001");
  });

  await test("an invalid URL is still rejected before anything is saved", async () => {
    await assert.rejects(() => queueProductForUser("https://example.com/not-oliveyoung", "user-a"));
  });

  await test("the worker's cycle fills in a queued product, which then stops looking pending", async () => {
    const calls: string[] = [];
    await runOneCycle(collector("SUCCESS", calls), { quietWhenIdle: true });
    assert.deepEqual(calls, ["Q0001"]);
    const saved = (await getProductById("Q0001"))!;
    assert.equal(saved.name, "상품 Q0001");
    assert.equal(saved.salePrice, 9900);
    assert.equal(isAwaitingFirstCollection(saved), false);
  });

  await test("an idle cycle collects nothing", async () => {
    const calls: string[] = [];
    await runOneCycle(collector("SUCCESS", calls), { quietWhenIdle: true });
    assert.deepEqual(calls, []);
  });

  await test("re-registering a product stuck in failure backoff moves it to the front again", async () => {
    await registerProductForUser(urlFor("Q0002"), "user-a", collector("NETWORK_ERROR"));
    const failedOnce = (await getProductById("Q0002"))!;
    assert.ok(failedOnce.nextCheckAt && failedOnce.nextCheckAt > new Date().toISOString(), "backed off into the future");
    assert.equal(failedOnce.consecutiveFailures, 1);

    await queueProductForUser(urlFor("Q0002"), "user-b");
    assert.equal((await getProductById("Q0002"))!.nextCheckAt, null);
    assert.ok(await getTracking("user-b", "Q0002"));
  });

  await test("re-registering an already collected product does not reschedule it", async () => {
    const before = (await getProductById("Q0001"))!.nextCheckAt;
    await queueProductForUser(urlFor("Q0001"), "user-b");
    assert.equal((await getProductById("Q0001"))!.nextCheckAt, before);
  });

  await test("worker catch-up finds only tracked products that were never collected", async () => {
    await registerProductForUser(urlFor("Q0003"), "user-a", collector("NETWORK_ERROR"));
    const ids = (await listUncollectedTrackedProductIds()).sort();
    assert.deepEqual(ids, ["Q0002", "Q0003"]);
    for (const id of ids) await markDueNow(id);
    const due = (await listDueTrackedProducts(new Date().toISOString())).map((p) => p.id).sort();
    assert.deepEqual(due, ["Q0002", "Q0003"]);
  });

  await test("on Vercel a cycle does not collect at all", async () => {
    const calls: string[] = [];
    const saved = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      await runOneCycle(collector("SUCCESS", calls));
    } finally {
      if (saved === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = saved;
    }
    assert.deepEqual(calls, []);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
