/**
 * Integration tests for AGENTS.md §20 TEST1–TEST8, run directly against the
 * domain layer (no browser, no real network) via injected collector stubs.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-scenarios.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import {
  registerProductForUser,
  recollectProduct,
  setTargetPriceForUser,
  InvalidOliveYoungUrlError,
  type Collector,
} from "@/lib/domain/collection";
import { getProductById, countTrackers, searchProducts, listPopularProducts, setCuratorUrl } from "@/lib/domain/products";
import { listPriceHistory } from "@/lib/domain/priceHistory";
import { listNotificationsForUser } from "@/lib/domain/notifications";
import { ensureUsersSeeded } from "@/lib/domain/users";
import type { CollectResult } from "@/collectors/oliveyoung/types";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) {
  throw new Error("Set DATABASE_PATH to an isolated test db file before running this script.");
}
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

function stubSuccess(overrides: {
  id: string;
  salePrice: number;
  normalPrice: number;
  name?: string;
  brand?: string;
}): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status: "SUCCESS",
    sourceUrl,
    checkedAt: new Date().toISOString(),
    data: {
      oliveyoungProductId: overrides.id,
      name: overrides.name ?? "테스트 수딩 크림",
      brand: overrides.brand ?? "테스트 브랜드",
      imageUrl: null,
      normalPrice: overrides.normalPrice,
      salePrice: overrides.salePrice,
      discountRate:
        overrides.normalPrice > overrides.salePrice
          ? Math.round(((overrides.normalPrice - overrides.salePrice) / overrides.normalPrice) * 100)
          : 0,
    },
  });
}

function stubFailure(status: Exclude<CollectResult["status"], "SUCCESS">, error: string): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status,
    sourceUrl,
    error,
    checkedAt: new Date().toISOString(),
  });
}

const PRODUCT_A_ID = "TEST0001";
const URL_A = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${PRODUCT_A_ID}`;
// Same product, different URL shape — must resolve to the same product (AGENTS.md §6).
const URL_A_VARIANT = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${PRODUCT_A_ID.toLowerCase()}&trackingId=abc123`;

async function main() {
  // In the real app, getCurrentUser() always seeds the fixed test users before
  // any action runs. This script calls domain functions directly, so seed once here.
  await ensureUsersSeeded();

  await test("TEST1: 사용자 A가 URL 등록 → 상품 생성 → 가격 저장 → 추적 등록", async () => {
    const result = await registerProductForUser(URL_A, "user-a", stubSuccess({ id: PRODUCT_A_ID, salePrice: 29900, normalPrice: 29900 }));
    assert.equal(result.product.id, PRODUCT_A_ID);
    assert.equal(result.product.salePrice, 29900);
    assert.equal(result.changeType, "initial");
    assert.equal(await countTrackers(PRODUCT_A_ID), 1);
    const history = await listPriceHistory(PRODUCT_A_ID);
    assert.equal(history.length, 1);
    assert.equal(history[0].changeType, "initial");
  });

  await test("TEST2: 사용자 B가 같은 상품(다른 URL 형태) 등록 → 신규 상품 생성 없이 연결, 추적자 +1", async () => {
    const result = await registerProductForUser(
      URL_A_VARIANT,
      "user-b",
      stubSuccess({ id: PRODUCT_A_ID, salePrice: 29900, normalPrice: 29900 })
    );
    assert.equal(result.product.id, PRODUCT_A_ID, "동일 oliveyoungProductId로 연결되어야 함");
    assert.equal(await countTrackers(PRODUCT_A_ID), 2, "사용자 A, B 두 명이 추적 중이어야 함");
    assert.equal((await listPriceHistory(PRODUCT_A_ID)).length, 1, "가격이 같으므로 이력이 늘어나지 않아야 함");
  });

  await test("TEST3: 가격 하락 → PriceHistory 생성 + 가격 하락 알림 생성", async () => {
    const outcome = await recollectProduct(PRODUCT_A_ID, stubSuccess({ id: PRODUCT_A_ID, salePrice: 27900, normalPrice: 29900 }));
    assert.equal(outcome.changeType, "decrease");
    const history = await listPriceHistory(PRODUCT_A_ID);
    assert.equal(history.length, 2);
    assert.equal(history.at(-1)?.price, 27900);

    const notifsA = (await listNotificationsForUser("user-a")).filter((n) => n.type === "price_drop");
    const notifsB = (await listNotificationsForUser("user-b")).filter((n) => n.type === "price_drop");
    assert.equal(notifsA.length, 1, "추적 중인 사용자 A에게 하락 알림이 생성되어야 함");
    assert.equal(notifsB.length, 1, "추적 중인 사용자 B에게 하락 알림이 생성되어야 함");
    assert.match(notifsA[0].message, /2,000원 하락했습니다/);
  });

  await test("TEST4: 동일 가격 재수집 → 불필요한 PriceHistory/알림 생성 없음", async () => {
    const beforeHistoryLen = (await listPriceHistory(PRODUCT_A_ID)).length;
    const beforeNotifCount = (await listNotificationsForUser("user-a")).length;
    const outcome = await recollectProduct(PRODUCT_A_ID, stubSuccess({ id: PRODUCT_A_ID, salePrice: 27900, normalPrice: 29900 }));
    assert.equal(outcome.changeType, "same");
    assert.equal((await listPriceHistory(PRODUCT_A_ID)).length, beforeHistoryLen, "가격 이력이 늘어나면 안 됨");
    assert.equal((await listNotificationsForUser("user-a")).length, beforeNotifCount, "알림이 추가로 생성되면 안 됨");
    const product = (await getProductById(PRODUCT_A_ID))!;
    assert.ok(product.lastCheckedAt, "lastCheckedAt은 여전히 갱신되어야 함");
  });

  await test("TEST5: 크롤링 실패 → 기존 가격 유지 + 실패 상태 기록", async () => {
    const before = (await getProductById(PRODUCT_A_ID))!;
    const historyLenBefore = (await listPriceHistory(PRODUCT_A_ID)).length;
    const outcome = await recollectProduct(PRODUCT_A_ID, stubFailure("NETWORK_ERROR", "테스트: 네트워크 실패"));
    assert.equal(outcome.changeType, null);
    const after = (await getProductById(PRODUCT_A_ID))!;
    assert.equal(after.salePrice, before.salePrice, "기존 가격이 유지되어야 함 (0원/삭제 금지)");
    assert.equal(after.lastCollectStatus, "NETWORK_ERROR");
    assert.equal(after.lastCollectError, "테스트: 네트워크 실패");
    assert.equal((await listPriceHistory(PRODUCT_A_ID)).length, historyLenBefore, "실패는 이력을 늘리지 않아야 함");
  });

  await test("TEST6: 상품 검색 → 등록된 상품을 이름/브랜드로 찾을 수 있음", async () => {
    const byName = await searchProducts("테스트 수딩 크림");
    assert.ok(byName.some((p) => p.id === PRODUCT_A_ID));
    const byBrand = await searchProducts("테스트 브랜드");
    assert.ok(byBrand.some((p) => p.id === PRODUCT_A_ID));
    const noMatch = await searchProducts("존재하지않는상품명xyz");
    assert.equal(noMatch.length, 0);
  });

  await test("TEST7: 인기상품 → 추적 사용자가 많은 상품이 상위 표시", async () => {
    const PRODUCT_B_ID = "TEST0002";
    const URL_B = `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${PRODUCT_B_ID}`;
    await registerProductForUser(URL_B, "user-c", stubSuccess({ id: PRODUCT_B_ID, salePrice: 9900, normalPrice: 9900, name: "테스트 틴트" }));
    assert.equal(await countTrackers(PRODUCT_A_ID), 2);
    assert.equal(await countTrackers(PRODUCT_B_ID), 1);
    const popular = await listPopularProducts(10);
    const indexA = popular.findIndex((p) => p.id === PRODUCT_A_ID);
    const indexB = popular.findIndex((p) => p.id === PRODUCT_B_ID);
    assert.ok(indexA !== -1 && indexB !== -1);
    assert.ok(indexA < indexB, "추적자가 더 많은 상품 A가 상위에 있어야 함");
  });

  await test("TEST8: 큐레이터 URL 등록 → 상품에 반영됨 (구매하기 이동 대상)", async () => {
    assert.equal((await getProductById(PRODUCT_A_ID))!.curatorUrl, null, "등록 전에는 curatorUrl이 없어야 함");
    await setCuratorUrl(PRODUCT_A_ID, "https://curator.example.com/buy/TEST0001");
    assert.equal((await getProductById(PRODUCT_A_ID))!.curatorUrl, "https://curator.example.com/buy/TEST0001");
  });

  await test("추가: 목표 가격 도달 시 즉시 알림 생성", async () => {
    const before = (await listNotificationsForUser("user-a")).filter((n) => n.type === "target_price").length;
    await setTargetPriceForUser("user-a", PRODUCT_A_ID, 28000); // 현재가 27,900원 → 이미 목표 이하
    const after = (await listNotificationsForUser("user-a")).filter((n) => n.type === "target_price").length;
    assert.equal(after, before + 1);
  });

  await test("추가: 올바르지 않은/타 쇼핑몰 URL은 등록 거부", async () => {
    await assert.rejects(() => registerProductForUser("이건 URL이 아님", "user-a", stubSuccess({ id: "X", salePrice: 1, normalPrice: 1 })), InvalidOliveYoungUrlError);
    await assert.rejects(
      () => registerProductForUser("https://www.coupang.com/vp/products/123", "user-a", stubSuccess({ id: "X", salePrice: 1, normalPrice: 1 })),
      InvalidOliveYoungUrlError
    );
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
