/**
 * Unit tests for listDueTrackedProducts' ordering and cap (lib/domain/products.ts) —
 * the safeguard against a growing backlog making every scheduler tick get
 * skipped (see chat history: "재수집에 누락되는 상품은 없는가?").
 *
 * Run with:
 *   DATABASE_PATH=.data/verify5.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-due-products.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { listDueTrackedProducts, updateSchedulingMeta } from "@/lib/domain/products";
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
      name: `테스트 상품 ${id}`,
      brand: "테스트",
      imageUrl: null,
      normalPrice: 10000,
      salePrice: 10000,
      discountRate: 0,
    },
  });
}

async function main() {
  await ensureUsersSeeded();

  // Five tracked products, each with a distinct next_check_at spread across the past.
  const ids = ["DUE0001", "DUE0002", "DUE0003", "DUE0004", "DUE0005"];
  for (const id of ids) {
    const url = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`;
    await registerProductForUser(url, "user-a", stubSuccess(id));
  }

  const now = new Date("2026-01-01T00:00:00.000Z");
  // Deliberately set out of chronological order to prove the query re-sorts them.
  const offsetsMin = { DUE0001: 10, DUE0002: 50, DUE0003: 5, DUE0004: 30, DUE0005: 20 };
  for (const [id, minutesAgo] of Object.entries(offsetsMin)) {
    await updateSchedulingMeta(id, {
      nextCheckAt: new Date(now.getTime() - minutesAgo * 60_000).toISOString(),
      consecutiveFailures: 0,
      consecutiveSameCount: 0,
    });
  }

  await test("가장 오래 기다린(next_check_at이 가장 이른) 상품부터 순서대로 반환됨", async () => {
    const due = await listDueTrackedProducts(now.toISOString());
    const order = due.map((p) => p.id);
    assert.deepEqual(order, ["DUE0002", "DUE0004", "DUE0005", "DUE0001", "DUE0003"]);
  });

  await test("limit을 주면 가장 오래 기다린 것부터 그 개수만큼만 반환됨", async () => {
    const due = await listDueTrackedProducts(now.toISOString(), 2);
    assert.deepEqual(
      due.map((p) => p.id),
      ["DUE0002", "DUE0004"]
    );
  });

  await test("next_check_at이 미래인 상품은 대상에서 제외됨", async () => {
    await updateSchedulingMeta("DUE0003", {
      nextCheckAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
      consecutiveFailures: 0,
      consecutiveSameCount: 0,
    });
    const due = await listDueTrackedProducts(now.toISOString());
    assert.ok(!due.some((p) => p.id === "DUE0003"));
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
