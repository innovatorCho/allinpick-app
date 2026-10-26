/**
 * Unit tests for the OliveYoung parser/identify helpers (no network) and the
 * dev-only sample-data generator. Complements scripts/verify/test-scenarios.ts.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify2.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-parser-and-seed.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { parseProductHtml } from "@/collectors/oliveyoung/parser";
import { ProductNotFoundError, PriceNotFoundError } from "@/collectors/oliveyoung/errors";
import { extractOliveYoungProductId, InvalidOliveYoungUrlError } from "@/collectors/oliveyoung/identify";
import { generateSampleData, hasSeedData } from "@/lib/domain/seed";
import { listAllProducts, countTrackers } from "@/lib/domain/products";
import { listPriceHistory } from "@/lib/domain/priceHistory";
import { ensureUsersSeeded } from "@/lib/domain/users";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);
await ensureUsersSeeded();

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

const SAMPLE_URL = "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000198669";

const JSON_LD_HTML = `
<html><head>
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Product",
  name: "레드 블레미쉬 수딩 크림",
  brand: { "@type": "Brand", name: "닥터지" },
  image: "https://image.oliveyoung.co.kr/sample.jpg",
  offers: { "@type": "Offer", price: "22400", priceCurrency: "KRW" },
})}
</script>
</head><body></body></html>`;

const NOT_FOUND_HTML = `<html><body><p>존재하지 않는 상품입니다.</p></body></html>`;

// Meta tags exactly as captured from a real, live OliveYoung product page during
// development (see collectors/oliveyoung/browserFetcher.ts + parser.ts doc
// comments) — the `og:image` value here is a real full URL, and there was no
// JSON-LD on the real page at all, which is why this strategy exists.
const REAL_PRODUCT_URL = "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000263035";
const REAL_META_TAG_HTML = `
<html><head>
<title>[9월 올영픽/산리오] 아비브 어성초 흔적 에센스 패드 클리어터치 70매 기획 (+70매 리필+패드케이스+스티커) | 올리브영</title>
<meta property="og:title" content="[9월 올영픽/산리오] 아비브 어성초 흔적 에센스 패드 클리어터치 70매 기획 (+70매 리필+패드케이스+스티커) | 올리브영">
<meta property="og:url" content="${REAL_PRODUCT_URL}">
<meta property="og:image" content="https://image.oliveyoung.co.kr/cfimages/cf-goods/uploads/images/thumbnails/10/0000/0026/A00000026303503ko.png?l=ko">
<meta property="eg:type" content="product">
<meta property="eg:itemId" content="8800280697691">
<meta property="eg:itemName" content="[9월 올영픽/산리오] 아비브 어성초 흔적 에센스 패드 클리어터치 70매 기획 (+70매 리필+패드케이스+스티커)">
<meta property="eg:itemImage" content="10/0000/0026/A00000026303503ko.png?l=ko">
<meta property="eg:originalPrice" content="40000">
<meta property="eg:salePrice" content="28000">
<meta property="eg:brandId" content="A001728">
<meta property="eg:brandName" content="아비브">
</head><body></body></html>`;

const NO_PRICE_HTML = `
<html><head>
<script type="application/ld+json">
${JSON.stringify({ "@type": "Product", name: "가격 없는 상품" })}
</script>
</head></html>`;

await test("identify: goodsNo 쿼리에서 상품 ID 추출", () => {
  assert.equal(extractOliveYoungProductId(SAMPLE_URL), "A000000198669");
});

await test("identify: 소문자/트래킹 파라미터가 섞여도 동일 ID로 정규화", () => {
  const variant = "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=a000000198669&trackingId=x";
  assert.equal(extractOliveYoungProductId(variant), "A000000198669");
});

await test("identify: 올리브영이 아닌 URL은 거부", () => {
  assert.throws(() => extractOliveYoungProductId("https://www.coupang.com/vp/products/1"), InvalidOliveYoungUrlError);
});

await test("identify: goodsNo가 없는 올리브영 URL은 거부", () => {
  assert.throws(() => extractOliveYoungProductId("https://www.oliveyoung.co.kr/store/main/main.do"), InvalidOliveYoungUrlError);
});

await test("parser: 실제 올리브영 페이지의 eg:* 메타태그에서 이름/브랜드/이미지/정상가/판매가 추출 (실 데이터 검증됨)", () => {
  const parsed = parseProductHtml(REAL_META_TAG_HTML, REAL_PRODUCT_URL);
  assert.equal(parsed.oliveyoungProductId, "A000000263035");
  assert.equal(parsed.name, "[9월 올영픽/산리오] 아비브 어성초 흔적 에센스 패드 클리어터치 70매 기획 (+70매 리필+패드케이스+스티커)");
  assert.equal(parsed.brand, "아비브");
  assert.equal(
    parsed.imageUrl,
    "https://image.oliveyoung.co.kr/cfimages/cf-goods/uploads/images/thumbnails/10/0000/0026/A00000026303503ko.png?l=ko"
  );
  assert.equal(parsed.normalPrice, 40000);
  assert.equal(parsed.salePrice, 28000);
  assert.equal(parsed.discountRate, 30);
});

await test("parser: JSON-LD Product 스키마에서 이름/브랜드/이미지/가격 추출", () => {
  const parsed = parseProductHtml(JSON_LD_HTML, SAMPLE_URL);
  assert.equal(parsed.oliveyoungProductId, "A000000198669");
  assert.equal(parsed.name, "레드 블레미쉬 수딩 크림");
  assert.equal(parsed.brand, "닥터지");
  assert.equal(parsed.imageUrl, "https://image.oliveyoung.co.kr/sample.jpg");
  assert.equal(parsed.salePrice, 22400);
});

await test("parser: 상품 없음 페이지는 ProductNotFoundError", () => {
  assert.throws(() => parseProductHtml(NOT_FOUND_HTML, SAMPLE_URL), ProductNotFoundError);
});

await test("parser: 가격 정보가 없으면 PriceNotFoundError", () => {
  assert.throws(() => parseProductHtml(NO_PRICE_HTML, SAMPLE_URL), PriceNotFoundError);
});

await test("seed: 샘플 데이터 생성 → 10개 상품 + 추적 관계 + 가격 이력 생성", async () => {
  assert.equal(await hasSeedData(), false);
  const summary = await generateSampleData();
  assert.equal(summary.productsCreated, 10);
  assert.ok(summary.priceHistoryRowsCreated > 0);
  assert.ok(summary.trackingRowsCreated > 0);
  assert.equal(await hasSeedData(), true);
  assert.equal((await listAllProducts()).length, 10);
  assert.ok((await countTrackers("SEED0001")) >= 3);
  assert.ok((await listPriceHistory("SEED0001")).length >= 3);
});

await test("seed: 두 번째 호출은 중복 생성 없이 no-op", async () => {
  const before = (await listAllProducts()).length;
  const summary = await generateSampleData();
  assert.equal(summary.productsCreated, 0);
  assert.equal((await listAllProducts()).length, before);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
