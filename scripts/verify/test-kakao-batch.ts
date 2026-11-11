/**
 * Tests for batched Kakao price alerts (lib/kakaoBatch.ts): price drops found
 * by the collector are queued, and each user gets at most one Kakao message
 * per window — the product's own alert when only one is waiting, otherwise a
 * single summary with the biggest drop as the card and a link to the full
 * list. Kakao is stubbed through global fetch; nothing hits the real API.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-kakao-batch.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-kakao-batch.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { recollectProduct, registerProductForUser, type Collector } from "@/lib/domain/collection";
import { listNotificationsForUser, listPendingKakaoForUser } from "@/lib/domain/notifications";
import { createOAuthUser, ensureUsersSeeded } from "@/lib/domain/users";
import { setTargetPrice, trackProduct } from "@/lib/domain/tracking";
import { listRecentKakaoSendLogs } from "@/lib/domain/kakaoSendLogs";
import {
  DEFAULT_BATCH_WINDOW_MINUTES,
  DEFAULT_SUMMARY_TEMPLATE,
  getKakaoBatchSettings,
  saveKakaoBatchSettings,
} from "@/lib/domain/kakaoBatchSettings";
import { flushKakaoBatches } from "@/lib/kakaoBatch";
import { buildKakaoSummaryObject } from "@/lib/kakaoMessaging";
import type { CollectResult } from "@/collectors/oliveyoung/types";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

process.env.KAKAO_CLIENT_ID = "test-kakao-client-id";
process.env.KAKAO_CLIENT_SECRET = "test-kakao-client-secret";
process.env.APP_BASE_URL = "https://allinpick.test";
delete process.env.KAKAO_BATCH_WINDOW_MINUTES;
delete process.env.KAKAO_SUMMARY_TEMPLATE;

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

/** Every Kakao "나에게 보내기" request made, as its parsed template_object. */
const sent: Record<string, unknown>[] = [];
globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
  if (String(url).includes("/talk/memo/default/send")) {
    const body = new URLSearchParams(String(init?.body ?? ""));
    sent.push(JSON.parse(body.get("template_object") ?? "{}"));
    return new Response(JSON.stringify({ result_code: 0 }), { status: 200 });
  }
  throw new Error(`unexpected fetch in test: ${String(url)}`);
}) as typeof fetch;

const urlFor = (id: string) => `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`;

function priced(price: number, image = true): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const id = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/)?.[1] ?? "";
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      data: {
        oliveyoungProductId: id,
        name: `묶음알림 상품 ${id}`,
        brand: "테스트",
        imageUrl: image ? `https://image.test/${id}.jpg` : null,
        normalPrice: 20000,
        salePrice: price,
        discountRate: 0,
      },
    };
  };
}

const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);

async function main() {
  await ensureUsersSeeded();
  const user = await createOAuthUser({
    provider: "kakao",
    providerUserId: "kakao-batch-user",
    email: null,
    name: "묶음알림유저",
    isAdmin: false,
    tokens: { accessToken: "tok-batch", refreshToken: null, expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
  });

  for (const id of ["KB01", "KB02", "KB03", "KB04"]) {
    await registerProductForUser(urlFor(id), user.id, priced(10000, id !== "KB04"));
  }

  await test("collector price drops are saved in-app right away but nothing goes to Kakao until the batch is sent", async () => {
    await recollectProduct("KB01", priced(9000));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 0);
    assert.equal((await listNotificationsForUser(user.id)).filter((n) => n.type === "price_drop").length, 1);
    assert.equal((await listPendingKakaoForUser(user.id)).length, 1);
  });

  await test("one product waiting → that product's own alert, and the queue is emptied", async () => {
    await flushKakaoBatches();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].object_type, "feed");
    assert.equal((sent[0].content as { title: string }).title, "묶음알림 상품 KB01");
    assert.equal((await listPendingKakaoForUser(user.id)).length, 0);
  });

  await test("more drops within the window wait instead of sending another message", async () => {
    await recollectProduct("KB02", priced(8000)); // drop 2,000
    await recollectProduct("KB03", priced(5000)); // drop 5,000 — biggest
    await recollectProduct("KB04", priced(9500)); // drop 500, no image
    await flushKakaoBatches(later(10));
    assert.equal(sent.length, 1, "within 60 minutes of the last message nothing more is sent");
    assert.equal((await listPendingKakaoForUser(user.id)).length, 3);
  });

  await test("after the window → one summary: biggest drop as the card, buttons to it and to the full list", async () => {
    await flushKakaoBatches(later(DEFAULT_BATCH_WINDOW_MINUTES + 1));
    assert.equal(sent.length, 2);
    const summary = sent[1] as {
      object_type: string;
      content: { title: string; description: string; image_url: string; link: { web_url: string } };
      item_content: {
        title_image_text: string;
        title_image_category: string;
        items: { item: string; item_op: string }[];
        sum: string;
        sum_op: string;
      };
      buttons: { title: string; link: { web_url: string } }[];
    };
    assert.equal(summary.object_type, "feed");
    assert.equal(summary.content.image_url, "https://image.test/KB03.jpg");
    assert.equal(summary.content.link.web_url, "https://allinpick.test/product/KB03");
    assert.equal(summary.content.title, "🔥 5,000원 내렸어요! (50% ↓)");
    assert.equal(
      summary.content.description,
      "🏆 추적 시작 이후 최저가예요! 관심 상품 3개의 가격이 내려갔어요. 품절 전에 확인해보세요 👇"
    );
    assert.equal(summary.item_content.title_image_text, "묶음알림 상품 KB03");
    assert.equal(summary.item_content.title_image_category, "테스트");
    assert.deepEqual(summary.item_content.items, [
      { item: "이전 가격", item_op: "10,000원" },
      { item: "현재 가격", item_op: "5,000원" },
      { item: "내린 금액", item_op: "5,000원" },
    ]);
    assert.deepEqual([summary.item_content.sum, summary.item_content.sum_op], ["할인율", "50% ↓"]);
    assert.ok(summary.item_content.items.every((i) => i.item.length <= 6), "Kakao shows at most 6 characters per label");
    assert.deepEqual(
      summary.buttons.map((b) => [b.title, b.link.web_url]),
      [
        ["이 상품 보기", "https://allinpick.test/product/KB03"],
        ["3개 모두 보기", "https://allinpick.test/my#notifications"],
      ]
    );
    assert.equal((await listPendingKakaoForUser(user.id)).length, 0);
  });

  await test("promo tags at the start of a name are left out of the price table title", () => {
    const object = buildKakaoSummaryObject({
      count: 2,
      title: "t",
      description: "d",
      top: {
        productId: "X",
        name: "[1+1리필기획/아이돌광채세럼] 비긴스 바이 정샘물 나이아신아마이드10 흔적세럼",
        brand: "비긴스 바이 정샘물",
        imageUrl: "https://image.test/X.jpg",
        oldPrice: 42000,
        newPrice: 25940,
      },
    }) as { item_content: { title_image_text: string } };
    assert.equal(object.item_content.title_image_text, "비긴스 바이 정샘물 나이아신아마이드10 흔…");
    assert.ok(object.item_content.title_image_text.length <= 24);
  });

  await test("the admin send history still lists every product of a summary", async () => {
    const logs = (await listRecentKakaoSendLogs()).filter((l) => l.userId === user.id && l.detail?.startsWith("묶음 발송"));
    assert.deepEqual(logs.map((l) => l.productId).sort(), ["KB02", "KB03", "KB04"]);
    assert.ok(logs.every((l) => l.status === "sent"));
  });

  await test("a product reaching its target sends one target alert, not a drop alert plus a target alert", async () => {
    await setTargetPrice(user.id, "KB01", 8500);
    await recollectProduct("KB01", priced(8000));
    assert.equal((await listPendingKakaoForUser(user.id)).length, 2, "both in-app notifications exist");
    await flushKakaoBatches(later(2 * DEFAULT_BATCH_WINDOW_MINUTES + 2));
    assert.equal(sent.length, 3, "a single Kakao message");
    assert.match(String(sent[2].text ?? (sent[2].content as { description?: string })?.description), /목표가/);
  });

  await test("window 0 sends on every pass; settings resolve admin → env → default", async () => {
    assert.deepEqual(await saveKakaoBatchSettings({ windowMinutes: "0", summaryTitleTemplate: "", summaryTemplate: "" }), {});
    await recollectProduct("KB02", priced(7000));
    await flushKakaoBatches();
    assert.equal(sent.length, 4);

    assert.ok((await saveKakaoBatchSettings({ windowMinutes: "-5", summaryTitleTemplate: "", summaryTemplate: "" })).error, "invalid minutes rejected");
    assert.ok((await saveKakaoBatchSettings({ windowMinutes: "abc", summaryTitleTemplate: "", summaryTemplate: "" })).error);

    await saveKakaoBatchSettings({ windowMinutes: "", summaryTitleTemplate: "", summaryTemplate: "" });
    process.env.KAKAO_BATCH_WINDOW_MINUTES = "15";
    let settings = await getKakaoBatchSettings();
    assert.equal(settings.windowMinutes, 15);
    assert.equal(settings.sources.windowMinutes, "env");
    assert.equal(settings.summaryTemplate, DEFAULT_SUMMARY_TEMPLATE);
    delete process.env.KAKAO_BATCH_WINDOW_MINUTES;
    settings = await getKakaoBatchSettings();
    assert.equal(settings.windowMinutes, DEFAULT_BATCH_WINDOW_MINUTES);
    assert.equal(settings.sources.windowMinutes, "default");
  });

  await test("a user without a linked Kakao account: skipped, logged, and not retried forever", async () => {
    await trackProduct("user-a", "KB03");
    await recollectProduct("KB03", priced(4000));
    const before = sent.length;
    await flushKakaoBatches(later(10 * DEFAULT_BATCH_WINDOW_MINUTES));
    assert.equal((await listPendingKakaoForUser("user-a")).length, 0);
    const skipped = (await listRecentKakaoSendLogs()).filter((l) => l.userId === "user-a" && l.status === "skipped");
    assert.equal(skipped.length, 1);
    assert.equal(sent.length, before + 1, "only the Kakao-linked user got a message");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
