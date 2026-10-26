/**
 * Unit tests for KakaoTalk "나에게 보내기" notification sending (Method B —
 * lib/kakaoMessaging.ts, and its opt-in `sendKakao` wiring in
 * lib/domain/notifications.ts's createNotification). Network calls to Kakao
 * are stubbed via a global.fetch replacement; nothing here hits the real
 * Kakao API.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-kakao.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-kakao-messaging.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import { createNotification, listNotificationsForUser } from "@/lib/domain/notifications";
import { createOAuthUser, getOAuthAccount, ensureUsersSeeded } from "@/lib/domain/users";
import { getProductById } from "@/lib/domain/products";
import { listRecentKakaoSendLogs } from "@/lib/domain/kakaoSendLogs";
import {
  DEFAULT_KAKAO_TEMPLATES,
  renderKakaoTemplate,
  setKakaoTemplate,
  truncateProductName,
} from "@/lib/domain/kakaoTemplates";
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const originalFetch = globalThis.fetch;
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

function stubProductCollector(id: string, imageUrl: string | null = null, name?: string): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status: "SUCCESS",
    sourceUrl,
    checkedAt: new Date().toISOString(),
    data: {
      oliveyoungProductId: id,
      name: name ?? `카카오알림테스트 상품 ${id}`,
      brand: "테스트",
      imageUrl,
      normalPrice: 10000,
      salePrice: 10000,
      discountRate: 0,
    },
  });
}

async function main() {
  await ensureUsersSeeded();

  const productId = "KAKAO0001"; // 이미지 없음 — feed→text 폴백 테스트에 씀
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productId}`,
    "user-a",
    stubProductCollector(productId)
  );

  const productWithImageId = "KAKAO0002";
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productWithImageId}`,
    "user-a",
    stubProductCollector(productWithImageId, "https://image.oliveyoung.co.kr/example/KAKAO0002.jpg")
  );

  const longNameProductId = "KAKAO0003";
  const longProductName = "말줄임 처리 확인용 매우 매우 매우 긴 상품명 립밤 앤 클렌징 스페셜 기획 세트";
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${longNameProductId}`,
    "user-a",
    stubProductCollector(longNameProductId, "https://image.oliveyoung.co.kr/example/KAKAO0003.jpg", longProductName)
  );

  await test("sendKakao 생략(기본값) → 카카오 연동 계정이 있어도 fetch가 호출되지 않음", async () => {
    await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-default-off",
      email: null,
      name: "카카오유저-기본값",
      isAdmin: false,
      tokens: { accessToken: "tok-unused", refreshToken: null, expiresAt: new Date(Date.now() + 3_600_000).toISOString() },
    });
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: "user-a",
        productId,
        type: "price_drop",
        message: "sendKakao 생략 테스트",
        oldPrice: 10000,
        newPrice: 9000,
      });
      await wait(20);
      assert.equal(fetchCalled, false, "sendKakao를 지정하지 않으면 카카오 전송을 시도하면 안 됨");
    } finally {
      restoreFetch();
    }
  });

  await test("sendKakao: true, 카카오 계정 미연동 사용자 → fetch 호출 없이 조용히 무시되고 알림은 정상 생성됨", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: "user-b", // 시딩된 테스트 유저 — 카카오 계정 연동 없음
        productId,
        type: "price_drop",
        message: "카카오 미연동 사용자 테스트",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await wait(20);
      assert.equal(fetchCalled, false, "연동된 카카오 계정이 없으면 fetch를 호출하면 안 됨");
      assert.ok(
        (await listNotificationsForUser("user-b")).some((n) => n.message === "카카오 미연동 사용자 테스트"),
        "카카오 전송 여부와 무관하게 인앱 알림은 항상 생성되어야 함"
      );
      const [latestLog] = await listRecentKakaoSendLogs(1);
      assert.equal(latestLog.userId, "user-b");
      assert.equal(latestLog.status, "skipped", "미연동 사용자는 kakao_send_logs에 'skipped'로 남아야 함");
      assert.ok(latestLog.detail, "스킵 사유가 detail에 남아야 함 (나중에 왜 안 갔는지 알 수 있도록)");
    } finally {
      restoreFetch();
    }
  });

  await test("sendKakao: true + 유효한 토큰 → Memo API에 올바른 인증/페이로드로 전송됨", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-valid",
      email: null,
      name: "카카오유저-정상",
      isAdmin: false,
      tokens: {
        accessToken: "valid-access-token",
        refreshToken: "valid-refresh-token",
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(), // 아직 만료 전 → 갱신 없이 그대로 사용되어야 함
      },
    });

    // Held as an object property rather than a bare `let` — TS's control-flow
    // analysis doesn't track a plain variable's reassignment inside an
    // uninvoked closure, so a bare `let captured = null` reads back as
    // literal `null` forever and `captured!` collapses to `never`.
    const state: {
      captured: { url: string; authorization: string | null; templateObject: Record<string, unknown> } | null;
    } = { captured: null };
    let resolveSent: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      state.captured = {
        url: String(input),
        authorization: (init?.headers as Record<string, string> | undefined)?.Authorization ?? null,
        templateObject: JSON.parse(body.get("template_object") ?? "{}"),
      };
      resolveSent();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: user.id,
        productId,
        type: "price_drop",
        message: "10,000원 → 9,000원, 1,000원 하락했습니다.",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await Promise.race([sent, wait(500)]);

      assert.ok(state.captured, "Memo API가 호출되어야 함");
      const captured = state.captured;
      assert.equal(captured.url, "https://kapi.kakao.com/v2/api/talk/memo/default/send");
      assert.equal(captured.authorization, "Bearer valid-access-token", "만료 전 토큰은 갱신 없이 그대로 사용되어야 함");
      // 카카오 발송 문구는 인앱 알림의 `message`가 아니라, 관리자가 설정한 템플릿(기본값)으로 렌더링되어야 함.
      const product = await getProductById(productId);
      const expectedText = renderKakaoTemplate(DEFAULT_KAKAO_TEMPLATES.price_drop.template, {
        productName: product!.name,
        oldPrice: 10000,
        newPrice: 9000,
        productUrl: `http://localhost:3000/product/${productId}`,
      });
      assert.equal(captured.templateObject.text, expectedText);
      assert.ok(
        String(captured.templateObject.text).includes("1,000원"),
        "가격 하락 템플릿에는 {dropAmount}가 채워져 있어야 함"
      );
      assert.ok(
        String((captured.templateObject as { link?: { web_url?: string } }).link?.web_url).includes(productId),
        "딥링크는 해당 상품 상세페이지를 가리켜야 함"
      );

      // 저장된 토큰 자체는 변경되지 않아야 함(갱신을 시도하지 않았으므로).
      const account = await getOAuthAccount(user.id, "kakao");
      assert.equal(account?.access_token, "valid-access-token");

      // `sent`는 fetch 모의 함수 "안에서" (실제 fetch()가 resolve되기도 전에) resolve되므로,
      // 그 이후 코드(log("sent") 호출)가 실행될 미세한 시간 여유를 둬야 함 — state.captured처럼
      // fetch 모의 함수 내부에서 동기적으로 세팅되는 값과 달리, 로그 기록은 fetch 완료 "다음" 틱에 일어남.
      await wait(10);
      const [latestLog] = await listRecentKakaoSendLogs(1);
      assert.equal(latestLog.userId, user.id);
      assert.equal(latestLog.status, "sent", "정상 발송은 kakao_send_logs에 'sent'로 남아야 함");
      assert.equal(latestLog.detail, null);
    } finally {
      restoreFetch();
    }
  });

  await test("Memo API가 실패해도(HTTP 500) 예외가 전파되지 않고 알림 생성 자체는 항상 성공함", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-failing",
      email: null,
      name: "카카오유저-실패",
      isAdmin: false,
      tokens: {
        accessToken: "dead-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("에러", { status: 500 });
    }) as typeof fetch;

    try {
      // createNotification 자체가 던지면 이 테스트가 바로 실패(FAIL)로 기록된다 — 그 자체가 검증.
      await createNotification({
        userId: user.id,
        productId,
        type: "price_drop",
        message: "카카오 발송 실패 테스트",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await wait(50);
      assert.ok(fetchCalled, "실패 케이스도 실제로 fetch가 호출된 뒤에 실패해야 의미가 있음");
      assert.ok(
        (await listNotificationsForUser(user.id)).some((n) => n.message === "카카오 발송 실패 테스트"),
        "카카오 전송이 실패해도 인앱 알림 행은 이미 커밋되어 있어야 함"
      );
      const [latestLog] = await listRecentKakaoSendLogs(1);
      assert.equal(latestLog.userId, user.id);
      assert.equal(latestLog.status, "failed", "실패는 kakao_send_logs에 'failed'로 남아야 함");
      assert.ok(latestLog.detail?.includes("500"), "실패 사유(HTTP 상태 등)가 detail에 남아야 함");
    } finally {
      restoreFetch();
    }
  });

  await test("만료 임박 토큰 → refresh_token으로 자동 갱신 후 새 토큰으로 전송하고 DB에도 저장함", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-expiring",
      email: null,
      name: "카카오유저-만료임박",
      isAdmin: false,
      tokens: {
        accessToken: "old-access-token",
        refreshToken: "old-refresh-token",
        expiresAt: new Date(Date.now() - 60_000).toISOString(), // 이미 만료됨
      },
    });

    let memoAuthorization: string | null = null;
    let resolveSent: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("kauth.kakao.com/oauth/token")) {
        return new Response(
          JSON.stringify({ access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 21600 }),
          { status: 200 }
        );
      }
      memoAuthorization = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      resolveSent();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: user.id,
        productId,
        type: "price_drop",
        message: "토큰 갱신 테스트",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await Promise.race([sent, wait(500)]);

      assert.equal(memoAuthorization, "Bearer new-access-token", "갱신된 새 토큰으로 전송되어야 함");
      const account = await getOAuthAccount(user.id, "kakao");
      assert.equal(account?.access_token, "new-access-token", "갱신된 토큰이 DB에도 저장되어야 함");
      assert.equal(account?.refresh_token, "new-refresh-token");
    } finally {
      restoreFetch();
    }
  });

  await test("objectType: feed + 이미지 있는 상품 → feed 템플릿(이미지/제목/설명/버튼)으로 전송됨", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-feed-with-image",
      email: null,
      name: "카카오유저-피드",
      isAdmin: false,
      tokens: {
        accessToken: "feed-access-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await setKakaoTemplate("price_drop", { objectType: "feed", template: "{oldPrice} → {newPrice} 하락!" });

    const state: { captured: Record<string, unknown> | null } = { captured: null };
    let resolveSent: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      state.captured = JSON.parse(body.get("template_object") ?? "{}");
      resolveSent();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: user.id,
        productId: productWithImageId,
        type: "price_drop",
        message: "무시됨(카카오는 템플릿을 씀)",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await Promise.race([sent, wait(500)]);

      assert.ok(state.captured, "Memo API가 호출되어야 함");
      const captured = state.captured as {
        object_type: string;
        content: { title: string; description: string; image_url: string };
        buttons: unknown[];
      };
      assert.equal(captured.object_type, "feed");
      assert.equal(captured.content.image_url, "https://image.oliveyoung.co.kr/example/KAKAO0002.jpg");
      const productWithImage = await getProductById(productWithImageId);
      assert.equal(captured.content.title, productWithImage!.name);
      assert.equal(captured.content.description, "10,000원 → 9,000원 하락!");
      assert.equal(captured.buttons.length, 1);
    } finally {
      restoreFetch();
    }
  });

  await test("objectType: feed + 이미지 없는 상품 → 자동으로 text 형식으로 폴백함", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-feed-no-image",
      email: null,
      name: "카카오유저-피드-이미지없음",
      isAdmin: false,
      tokens: {
        accessToken: "feed-fallback-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await setKakaoTemplate("price_drop", { objectType: "feed", template: "{oldPrice} → {newPrice} 하락!" });

    const state: { captured: Record<string, unknown> | null } = { captured: null };
    let resolveSent: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      state.captured = JSON.parse(body.get("template_object") ?? "{}");
      resolveSent();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: user.id,
        productId, // KAKAO0001 — imageUrl: null
        type: "price_drop",
        message: "무시됨",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await Promise.race([sent, wait(500)]);

      assert.ok(state.captured, "Memo API가 호출되어야 함 (feed가 안 되면 text로라도 호출돼야 함)");
      assert.equal(
        state.captured!.object_type,
        "text",
        "이미지가 없는 상품은 feed 템플릿을 요청해도 text로 폴백해야 함"
      );
    } finally {
      restoreFetch();
    }
  });

  await test("feed 카드의 제목(content.title)은 긴 상품명을 말줄임 처리해서 보냄", async () => {
    const user = await createOAuthUser({
      provider: "kakao",
      providerUserId: "kt-feed-long-name",
      email: null,
      name: "카카오유저-긴이름",
      isAdmin: false,
      tokens: {
        accessToken: "long-name-token",
        refreshToken: null,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    });
    await setKakaoTemplate("price_drop", { objectType: "feed", template: "{oldPrice} → {newPrice}" });

    const state: { captured: Record<string, unknown> | null } = { captured: null };
    let resolveSent: () => void;
    const sent = new Promise<void>((resolve) => {
      resolveSent = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      state.captured = JSON.parse(body.get("template_object") ?? "{}");
      resolveSent();
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    try {
      await createNotification({
        userId: user.id,
        productId: longNameProductId,
        type: "price_drop",
        message: "무시됨",
        oldPrice: 10000,
        newPrice: 9000,
        sendKakao: true,
      });
      await Promise.race([sent, wait(500)]);

      assert.ok(state.captured, "Memo API가 호출되어야 함");
      const captured = state.captured as { content: { title: string } };
      assert.equal(captured.content.title, truncateProductName(longProductName));
      assert.ok(captured.content.title.endsWith("…"), "긴 상품명은 말줄임표로 끝나야 함");
      assert.notEqual(captured.content.title, longProductName, "원본 상품명이 그대로 전송되면 안 됨");
    } finally {
      restoreFetch();
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
