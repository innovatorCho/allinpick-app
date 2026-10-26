/**
 * Unit tests for the KakaoTalk send-visibility log (lib/domain/kakaoSendLogs.ts)
 * added so a fire-and-forget Kakao send's outcome is visible somewhere other
 * than the server console during unattended/automatic operation. The actual
 * wiring into lib/kakaoMessaging.ts's send path is covered end-to-end in
 * scripts/verify/test-kakao-messaging.ts.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-kakao-send-logs.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-kakao-send-logs.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { ensureUsersSeeded } from "@/lib/domain/users";
import { recordKakaoSendLog, listRecentKakaoSendLogs } from "@/lib/domain/kakaoSendLogs";
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
      name: `발송로그테스트 상품 ${id}`,
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

  const productId = "KLOG0001";
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productId}`,
    "user-a",
    stubSuccess(productId)
  );

  await test("recordKakaoSendLog: 기록 후 listRecentKakaoSendLogs에 사용자/상품 이름과 함께 조회됨", async () => {
    await recordKakaoSendLog({ userId: "user-a", productId, type: "price_drop", status: "sent" });
    const logs = await listRecentKakaoSendLogs();
    assert.equal(logs.length, 1);
    assert.equal(logs[0].userId, "user-a");
    assert.equal(logs[0].userName, "사용자 A");
    assert.equal(logs[0].productName, `발송로그테스트 상품 ${productId}`);
    assert.equal(logs[0].status, "sent");
    assert.equal(logs[0].detail, null);
  });

  await test("recordKakaoSendLog: skipped/failed 상태와 detail도 그대로 저장됨", async () => {
    await recordKakaoSendLog({
      userId: "user-b",
      productId,
      type: "target_price",
      status: "skipped",
      detail: "연동된 카카오 계정이 없음",
    });
    await recordKakaoSendLog({
      userId: "user-b",
      productId,
      type: "price_drop",
      status: "failed",
      detail: "카카오톡 메시지 전송 실패 (HTTP 500)",
    });

    const logs = await listRecentKakaoSendLogs();
    const skipped = logs.find((l) => l.status === "skipped");
    const failedLog = logs.find((l) => l.status === "failed");
    assert.equal(skipped?.detail, "연동된 카카오 계정이 없음");
    assert.equal(failedLog?.detail, "카카오톡 메시지 전송 실패 (HTTP 500)");
  });

  await test("listRecentKakaoSendLogs: 최신순(created_at DESC)으로 반환됨", async () => {
    const logs = await listRecentKakaoSendLogs();
    for (let i = 1; i < logs.length; i++) {
      assert.ok(logs[i - 1].id > logs[i].id, "더 나중에 기록된 로그(id가 큼)가 앞에 와야 함");
    }
  });

  await test("listRecentKakaoSendLogs: limit을 주면 그 개수만큼만 반환됨", async () => {
    const logs = await listRecentKakaoSendLogs(1);
    assert.equal(logs.length, 1);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
