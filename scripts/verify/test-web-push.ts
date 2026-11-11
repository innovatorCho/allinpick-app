/**
 * Tests for browser push alerts (lib/webPush.ts): they go out with every
 * Kakao alert, single or batched, with the same admin-template wording;
 * gone subscriptions are removed; and the batching window also holds for
 * users who only get push. The push service is stubbed by replacing
 * web-push's sendNotification; nothing leaves the machine.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-web-push.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-web-push.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import webpush from "web-push";

import { recollectProduct, registerProductForUser, type Collector } from "@/lib/domain/collection";
import { createOAuthUser, ensureUsersSeeded } from "@/lib/domain/users";
import { trackProduct } from "@/lib/domain/tracking";
import { listPushSubscriptionsForUser, savePushSubscription } from "@/lib/domain/pushSubscriptions";
import { saveSiteSettings } from "@/lib/domain/siteSettings";
import { flushKakaoBatches } from "@/lib/kakaoBatch";
import { sendWebPushToUser } from "@/lib/webPush";
import type { CollectResult } from "@/collectors/oliveyoung/types";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

process.env.KAKAO_CLIENT_ID = "test-kakao-client-id";
process.env.KAKAO_CLIENT_SECRET = "test-kakao-client-secret";
process.env.APP_BASE_URL = "https://allinpick.test";
delete process.env.KAKAO_BATCH_WINDOW_MINUTES;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

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

// Kakao is stubbed through fetch, like test-kakao-batch.ts.
let kakaoSent = 0;
globalThis.fetch = (async (url: string | URL) => {
  if (String(url).includes("/talk/memo/default/send")) {
    kakaoSent += 1;
    return new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
  }
  throw new Error(`unexpected fetch in test: ${String(url)}`);
}) as typeof fetch;

/** Every push sent, as [endpoint, parsed payload]. Endpoints in `gone` answer 410 like an expired subscription. */
const pushed: [string, Record<string, string>][] = [];
const gone = new Set<string>();
webpush.sendNotification = (async (sub: { endpoint: string }, payload?: string | Buffer | null) => {
  if (gone.has(sub.endpoint)) throw Object.assign(new Error("gone"), { statusCode: 410 });
  pushed.push([sub.endpoint, JSON.parse(String(payload))]);
  return { statusCode: 201, body: "", headers: {} };
}) as typeof webpush.sendNotification;

const urlFor = (id: string) => `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`;

function priced(price: number): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const id = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "";
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      data: {
        oliveyoungProductId: id,
        name: `푸시 상품 ${id}`,
        brand: "테스트",
        imageUrl: `https://image.test/${id}.jpg`,
        normalPrice: 20000,
        salePrice: price,
        discountRate: 0,
      },
    };
  };
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const sub = (endpoint: string) => ({ endpoint, p256dh: "BKey", auth: "auth" });

async function main() {
  await ensureUsersSeeded();
  const user = await createOAuthUser({
    provider: "kakao",
    providerUserId: "kakao-push-user",
    email: null,
    name: "푸시유저",
    isAdmin: false,
    tokens: { accessToken: "tok-push", refreshToken: null, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });
  for (const id of ["WP01", "WP02", "WP03"]) {
    await registerProductForUser(urlFor(id), user.id, priced(10000));
  }
  await savePushSubscription({ userId: user.id, ...sub("https://push.test/phone") });

  await test("without VAPID keys push is off: nothing is sent and nothing breaks", async () => {
    assert.equal(await sendWebPushToUser(user.id, { title: "t", body: "b", url: "/" }), 0);
    assert.equal(pushed.length, 0);
  });

  // Keys only need the right shape here; the push service itself is stubbed.
  const keys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;

  await test("one product waiting → a push worded like the Kakao alert, opening that product", async () => {
    await recollectProduct("WP01", priced(9000));
    await flushKakaoBatches();
    assert.equal(kakaoSent, 1);
    assert.equal(pushed.length, 1);
    const [endpoint, payload] = pushed[0];
    assert.equal(endpoint, "https://push.test/phone");
    assert.equal(payload.title, "푸시 상품 WP01");
    assert.match(payload.body, /9,000원/);
    assert.equal(payload.url, "https://allinpick.test/product/WP01");
    assert.equal(payload.icon, "https://allinpick.test/brand/icon-192.png");
  });

  await test("several products → one summary push with the Kakao summary's title, opening the full list", async () => {
    await recollectProduct("WP02", priced(8000));
    await recollectProduct("WP03", priced(5000));
    await flushKakaoBatches(later(61));
    assert.equal(kakaoSent, 2);
    assert.equal(pushed.length, 2);
    const payload = pushed[1][1];
    assert.equal(payload.title, "🔥 5,000원 내렸어요! (50% ↓)");
    assert.match(payload.body, /관심 상품 2개/);
    assert.match(payload.body, /푸시 상품 WP03 10,000원 → 5,000원/);
    assert.equal(payload.url, "https://allinpick.test/my#notifications");
    assert.equal(payload.tag, "price-summary");
  });

  await test("a subscription the push service reports gone is deleted; the others still get it", async () => {
    await savePushSubscription({ userId: user.id, ...sub("https://push.test/old-laptop") });
    gone.add("https://push.test/old-laptop");
    assert.equal(await sendWebPushToUser(user.id, { title: "t", body: "b", url: "/" }), 1);
    assert.deepEqual(
      (await listPushSubscriptionsForUser(user.id)).map((s) => s.endpoint),
      ["https://push.test/phone"]
    );
  });

  await test("a push-only user (no Kakao) gets alerts, and the batching window still applies to them", async () => {
    await savePushSubscription({ userId: "user-a", ...sub("https://push.test/user-a") });
    await trackProduct("user-a", "WP01");
    await recollectProduct("WP01", priced(8500));
    const before = pushed.filter(([e]) => e === "https://push.test/user-a").length;
    await flushKakaoBatches();
    assert.equal(pushed.filter(([e]) => e === "https://push.test/user-a").length, before + 1);

    await recollectProduct("WP01", priced(8000));
    await flushKakaoBatches(later(10));
    assert.equal(
      pushed.filter(([e]) => e === "https://push.test/user-a").length,
      before + 1,
      "10 minutes after the last push nothing more goes out"
    );
  });

  await test("the same browser subscribing under another account moves to that account", async () => {
    await savePushSubscription({ userId: "user-a", ...sub("https://push.test/phone") });
    assert.equal((await listPushSubscriptionsForUser(user.id)).length, 0);
    assert.ok((await listPushSubscriptionsForUser("user-a")).some((s) => s.endpoint === "https://push.test/phone"));
  });

  await test("the Kakao channel address must be an http(s) URL, as the channel admin center gives it", async () => {
    assert.ok((await saveSiteSettings({ kakaoChannelUrl: "pf.kakao.com/_abc" })).error);
    assert.ok((await saveSiteSettings({ kakaoChannelUrl: "javascript:alert(1)" })).error);
    assert.deepEqual(await saveSiteSettings({ kakaoChannelUrl: "http://pf.kakao.com/_abc" }), {});
    assert.deepEqual(await saveSiteSettings({ kakaoChannelUrl: "https://pf.kakao.com/_abc" }), {});
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
