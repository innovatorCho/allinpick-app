/**
 * Unit tests for the KakaoTalk message template admin feature
 * (lib/domain/kakaoTemplates.ts) — persistence, defaults, reset, and
 * {placeholder} substitution. Does not touch the network; see
 * scripts/verify/test-kakao-messaging.ts for the end-to-end wiring into an
 * actual send.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-kakao-templates.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-kakao-templates.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { getSetting, setSetting } from "@/lib/domain/settings";
import {
  getKakaoTemplate,
  getAllKakaoTemplates,
  setKakaoTemplate,
  resetKakaoTemplate,
  renderKakaoTemplate,
  truncateProductName,
  PRODUCT_NAME_MAX_LENGTH,
  DEFAULT_KAKAO_TEMPLATES,
  KAKAO_TEMPLATE_PLACEHOLDERS,
} from "@/lib/domain/kakaoTemplates";

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

await test("getKakaoTemplate: 아무것도 설정 안 하면 기본 템플릿(objectType 포함)을 반환함", async () => {
  assert.deepEqual(await getKakaoTemplate("price_drop"), DEFAULT_KAKAO_TEMPLATES.price_drop);
  assert.deepEqual(await getKakaoTemplate("target_price"), DEFAULT_KAKAO_TEMPLATES.target_price);
});

await test("setKakaoTemplate: objectType과 template을 함께 저장하고, 다른 타입은 영향 없음", async () => {
  await setKakaoTemplate("price_drop", { objectType: "feed", template: "커스텀: {productName} {oldPrice} -> {newPrice}" });
  assert.deepEqual(await getKakaoTemplate("price_drop"), {
    objectType: "feed",
    template: "커스텀: {productName} {oldPrice} -> {newPrice}",
  });
  assert.deepEqual(await getKakaoTemplate("target_price"), DEFAULT_KAKAO_TEMPLATES.target_price, "다른 타입 템플릿은 그대로여야 함");
});

await test("getAllKakaoTemplates: 두 타입을 한 번에 조회함", async () => {
  const all = await getAllKakaoTemplates();
  assert.deepEqual(all.price_drop, {
    objectType: "feed",
    template: "커스텀: {productName} {oldPrice} -> {newPrice}",
  });
  assert.deepEqual(all.target_price, DEFAULT_KAKAO_TEMPLATES.target_price);
});

await test("resetKakaoTemplate: 기본값(objectType 포함)으로 되돌림", async () => {
  await resetKakaoTemplate("price_drop");
  assert.deepEqual(await getKakaoTemplate("price_drop"), DEFAULT_KAKAO_TEMPLATES.price_drop);
});

await test("하위 호환: object_type 선택 기능 이전에 저장된 순수 문자열 템플릿은 text 타입으로 취급됨", async () => {
  // 예전 setKakaoTemplate(type, string)이 app_settings에 그대로 저장했던 원시 문자열을 흉내냄.
  await setSetting("kakao_template:price_drop", "레거시 문자열 템플릿: {productName}");
  assert.deepEqual(await getKakaoTemplate("price_drop"), {
    objectType: "text",
    template: "레거시 문자열 템플릿: {productName}",
  });
  assert.equal(
    await getSetting("kakao_template:price_drop"),
    "레거시 문자열 템플릿: {productName}",
    "읽기만으로는 저장된 값을 새 스키마로 다시 쓰지 않아야 함(다음 저장 시에만 승격)"
  );
});

await test("renderKakaoTemplate: 모든 변수를 정확히 치환함 (dropAmount는 old-new로 계산됨)", () => {
  const rendered = renderKakaoTemplate("{productName}: {oldPrice} → {newPrice} ({dropAmount} 하락, 목표 {targetPrice})", {
    productName: "테스트 상품",
    oldPrice: 10000,
    newPrice: 8500,
    targetPrice: 9000,
    productUrl: "https://example.com/product/X",
  });
  assert.equal(rendered, "테스트 상품: 10,000원 → 8,500원 (1,500원 하락, 목표 9,000원)");
});

await test("renderKakaoTemplate: 값이 없는 변수는 '-'로, 알 수 없는 {placeholder}는 그대로 남김", () => {
  const rendered = renderKakaoTemplate("가격 {oldPrice} / {unknownVar}", {
    productName: "상품",
    productUrl: "https://example.com",
  });
  assert.equal(rendered, "가격 - / {unknownVar}");
});

await test("renderKakaoTemplate: {productUrl}이 그대로 치환됨", () => {
  const rendered = renderKakaoTemplate("보러가기: {productUrl}", {
    productName: "상품",
    productUrl: "https://example.com/product/ABC",
  });
  assert.equal(rendered, "보러가기: https://example.com/product/ABC");
});

await test("truncateProductName: 제한 길이 이하면 그대로 반환함", () => {
  const shortName = "짧은 상품명";
  assert.equal(truncateProductName(shortName), shortName);
});

await test("truncateProductName: 정확히 제한 길이와 같으면 그대로 반환함 (경계값)", () => {
  const exactLength = "가".repeat(PRODUCT_NAME_MAX_LENGTH);
  assert.equal(truncateProductName(exactLength), exactLength);
});

await test("truncateProductName: 제한 길이를 넘으면 말줄임표(…)로 잘리고, 전체 길이도 제한을 넘지 않음", () => {
  const longName = "가".repeat(PRODUCT_NAME_MAX_LENGTH + 10);
  const truncated = truncateProductName(longName);
  assert.equal(truncated.length, PRODUCT_NAME_MAX_LENGTH);
  assert.ok(truncated.endsWith("…"));
  assert.ok(longName.startsWith(truncated.slice(0, -1)), "잘린 부분은 원본의 앞부분과 일치해야 함");
});

await test("renderKakaoTemplate: {productName}에도 말줄임이 적용됨", () => {
  const longName = "매우 긴 상품명 ".repeat(10);
  const rendered = renderKakaoTemplate("{productName}", {
    productName: longName,
    productUrl: "https://example.com",
  });
  assert.equal(rendered, truncateProductName(longName));
  assert.notEqual(rendered, longName, "원본 이름이 그대로 노출되면 안 됨");
});

await test("KAKAO_TEMPLATE_PLACEHOLDERS: price_drop과 target_price가 서로 다른 변수 집합을 노출함", () => {
  assert.ok(KAKAO_TEMPLATE_PLACEHOLDERS.price_drop.includes("dropAmount"));
  assert.ok(!KAKAO_TEMPLATE_PLACEHOLDERS.target_price.includes("dropAmount"));
  assert.ok(KAKAO_TEMPLATE_PLACEHOLDERS.target_price.includes("targetPrice"));
  assert.ok(!KAKAO_TEMPLATE_PLACEHOLDERS.price_drop.includes("targetPrice"));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
