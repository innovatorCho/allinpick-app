/**
 * Unit tests for the daily Kakao digest (lib/digestScheduler.ts) — the
 * per-user drop-count aggregation (lib/domain/notifications.ts), the
 * (user, day) idempotency log (lib/domain/kakaoDigestLogs.ts), the actual
 * send function (lib/kakaoMessaging.ts's sendKakaoDigest), and the
 * Asia/Seoul day-key/hour-gating helper. Network calls to Kakao are stubbed
 * via a global.fetch replacement; nothing here hits the real Kakao API.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-digest.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-digest.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { createNotification, listUsersWithPriceDropCountToday } from "@/lib/domain/notifications";
import { createOAuthUser, ensureUsersSeeded } from "@/lib/domain/users";
import { hasSentDigestToday, recordDigestLog, listRecentKakaoDigestLogs } from "@/lib/domain/kakaoDigestLogs";
import { sendKakaoDigest } from "@/lib/kakaoMessaging";
import { __testing as digestSchedulerTesting } from "@/lib/digestScheduler";
import type { CollectResult } from "@/collectors/oliveyoung/types";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

process.env.KAKAO_CLIENT_ID = "test-kakao-client-id";
process.env.KAKAO_CLIENT_SECRET = "test-kakao-client-secret";

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

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function stubProductCollector(id: string): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status: "SUCCESS",
    sourceUrl,
    checkedAt: new Date().toISOString(),
    data: {
      oliveyoungProductId: id,
      name: `다이제스트테스트 상품 ${id}`,
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

  await test("getKstDateKeyAndHour: UTC 자정 → KST 오전 9시, 같은 날짜", () => {
    const { dateKey, hour } = digestSchedulerTesting.getKstDateKeyAndHour(new Date("2026-10-16T00:00:00.000Z"));
    assert.equal(dateKey, "2026-10-16");
    assert.equal(hour, 9);
  });

  await test("getKstDateKeyAndHour: UTC 15:00 → 다음날 KST 0시 (날짜가 넘어감)", () => {
    const { dateKey, hour } = digestSchedulerTesting.getKstDateKeyAndHour(new Date("2026-10-16T15:00:00.000Z"));
    assert.equal(dateKey, "2026-10-17");
    assert.equal(hour, 0);
  });

  await test("getKstDateKeyAndHour: UTC 12:00(KST 21시) → 다이제스트 발송 시각 경계값", () => {
    const { hour } = digestSchedulerTesting.getKstDateKeyAndHour(new Date("2026-10-16T12:00:00.000Z"));
    assert.equal(hour, digestSchedulerTesting.DIGEST_HOUR_KST);
  });

  const productA = "DIGEST001";
  const productB = "DIGEST002";
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productA}`,
    "user-a",
    stubProductCollector(productA)
  );
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productB}`,
    "user-a",
    stubProductCollector(productB)
  );

  await test("listUsersWithPriceDropCountToday: price_drop만 세고, target_price나 사전 기간은 제외함", async () => {
    const sinceIso = new Date(Date.now() - 60_000).toISOString(); // 1분 전 — 아래 두 건만 "오늘"에 포함됨

    await createNotification({
      userId: "user-a",
      productId: productA,
      type: "price_drop",
      message: "하락1",
      oldPrice: 10000,
      newPrice: 9000,
    });
    await createNotification({
      userId: "user-a",
      productId: productB,
      type: "price_drop",
      message: "하락2",
      oldPrice: 10000,
      newPrice: 9500,
    });
    // target_price는 다이제스트 집계에서 제외되어야 함.
    await createNotification({
      userId: "user-a",
      productId: productA,
      type: "target_price",
      message: "목표가 도달",
      oldPrice: null,
      newPrice: 9000,
    });
    // 집계 시작 시각 이전 — 포함되면 안 됨(과거 날짜를 흉내).
    await createNotification({
      userId: "user-b",
      productId: productA,
      type: "price_drop",
      message: "범위 밖",
      oldPrice: 10000,
      newPrice: 9000,
    });

    const counts = await listUsersWithPriceDropCountToday(sinceIso);
    const userA = counts.find((c) => c.userId === "user-a");
    assert.ok(userA, "user-a는 집계에 포함되어야 함");
    assert.equal(userA!.count, 2, "price_drop 2건만 세어야 함 (target_price 제외)");
    assert.equal(userA!.singleProductId, null, "상품이 2개면 특정 상품을 가리키지 않음");

    // 같은 상품이 하루에 두 번 내려가도 1개 상품으로 셈 → 그 상품으로 바로 연결.
    for (const newPrice of [8000, 7000]) {
      await createNotification({ userId: "user-c", productId: productB, type: "price_drop", message: "하락", oldPrice: 9000, newPrice });
    }
    const userC = (await listUsersWithPriceDropCountToday(sinceIso)).find((c) => c.userId === "user-c");
    assert.equal(userC!.count, 1);
    assert.equal(userC!.singleProductId, productB);
  });

  await test("kakaoDigestLogs: 기록 전엔 false, 'sent' 기록 후엔 true, (user,date) upsert로 중복행이 안 생김", async () => {
    const digestDate = "2026-01-01";
    assert.equal(await hasSentDigestToday("user-c", digestDate), false);

    await recordDigestLog({ userId: "user-c", digestDate, dropCount: 2, status: "failed", detail: "일시 오류" });
    assert.equal(await hasSentDigestToday("user-c", digestDate), false, "failed는 '보냄'으로 치면 안 됨 — 같은 날 재시도 가능해야 함");

    await recordDigestLog({ userId: "user-c", digestDate, dropCount: 3, status: "sent" });
    assert.equal(await hasSentDigestToday("user-c", digestDate), true);

    const logs = await listRecentKakaoDigestLogs(100);
    const forUser = logs.filter((l) => l.userId === "user-c" && l.digestDate === digestDate);
    assert.equal(forUser.length, 1, "같은 (user, date)는 upsert되어 행이 1개여야 함(failed→sent로 덮어써짐)");
    assert.equal(forUser[0].status, "sent");
    assert.equal(forUser[0].dropCount, 3, "최신 시도의 dropCount로 덮어써져야 함");
  });

  await test("sendKakaoDigest: 카카오 미연동 사용자 → fetch 호출 없이 'skipped'로 기록됨", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await sendKakaoDigest("user-b", "2026-02-02", 1);
      assert.equal(fetchCalled, false);
      const [log] = (await listRecentKakaoDigestLogs(1)).filter((l) => l.userId === "user-b");
      assert.equal(log.status, "skipped");
      assert.equal(log.digestDate, "2026-02-02");
    } finally {
      restoreFetch();
    }
  });

  await test("sendKakaoDigest: 정상 발송 → text 템플릿으로 /my 링크를 담아 전송하고 'sent'로 기록됨", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-digest-ok",
      email: null,
      name: "다이제스트유저",
      isAdmin: false,
      tokens: {
        accessToken: "digest-access-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });

    const state: { captured: Record<string, unknown> | null; authorization: string | null } = {
      captured: null,
      authorization: null,
    };
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      state.captured = JSON.parse(body.get("template_object") ?? "{}");
      state.authorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await sendKakaoDigest(user.id, "2026-03-03", 4);

      assert.equal(state.authorization, "Bearer digest-access-token");
      assert.ok(state.captured, "Memo API가 호출되어야 함");
      assert.equal(state.captured!.object_type, "text");
      assert.ok(String(state.captured!.text).includes("4개"), "메시지에 하락 개수가 들어가야 함");
      const link = state.captured!.link as { web_url: string };
      assert.ok(link.web_url.endsWith("/my"), "딥링크는 /my(내 추적 목록)를 가리켜야 함, 특정 상품이 아님");

      const [log] = (await listRecentKakaoDigestLogs(1)).filter((l) => l.userId === user.id);
      assert.equal(log.status, "sent");
      assert.equal(log.dropCount, 4);
      assert.equal(log.digestDate, "2026-03-03");
    } finally {
      restoreFetch();
    }
  });

  await test("sendKakaoDigest: 오늘 내린 상품이 1개면 그 상품 상세 화면으로 연결됨", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-digest-single",
      email: null,
      name: "다이제스트단일",
      isAdmin: false,
      tokens: { accessToken: "digest-single-token", refreshToken: null, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    const state: { captured: { link: { web_url: string }; button_title: string } | null } = { captured: null };
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      state.captured = JSON.parse(new URLSearchParams(String(init?.body)).get("template_object") ?? "{}");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    try {
      await sendKakaoDigest(user.id, "2026-03-04", 1, "DIGEST002");
      assert.ok(state.captured);
      assert.ok(state.captured.link.web_url.endsWith("/product/DIGEST002"));
      assert.equal(state.captured.button_title, "상품 보기");
    } finally {
      restoreFetch();
    }
  });

  await test("sendKakaoDigest: Memo API 실패(HTTP 500) → 예외가 전파되지 않고 'failed'로 기록됨", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-digest-fail",
      email: null,
      name: "다이제스트유저-실패",
      isAdmin: false,
      tokens: {
        accessToken: "dead-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });

    globalThis.fetch = (async () => new Response("에러", { status: 500 })) as typeof fetch;

    try {
      // 던지면 이 테스트가 바로 FAIL로 기록된다 — 그 자체가 "예외가 전파되지 않음"의 검증.
      await sendKakaoDigest(user.id, "2026-04-04", 7);
      const [log] = (await listRecentKakaoDigestLogs(1)).filter((l) => l.userId === user.id);
      assert.equal(log.status, "failed");
      assert.ok(log.detail?.includes("500"));
    } finally {
      restoreFetch();
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
