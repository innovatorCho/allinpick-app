/**
 * Unit tests for the OliveYoung keyword-search fallback (crawl-on-miss),
 * added per explicit user request. Network calls are stubbed — see
 * scripts/verify/test-parser-and-seed.ts for why the goodsNo-extraction
 * regex itself still needs re-verification against a real page.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify3.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-search-crawl.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { crawlOliveYoungByKeyword } from "@/lib/domain/searchCrawl";
import { getProductById, countTrackers } from "@/lib/domain/products";
import { ensureUsersSeeded } from "@/lib/domain/users";
import type { Collector } from "@/lib/domain/collection";
import { extractGoodsNos } from "@/collectors/oliveyoung/searchCollector";
import type { SearchCrawlResult } from "@/collectors/oliveyoung/searchCollector";
import type { CollectResult } from "@/collectors/oliveyoung/types";

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

function stubSearch(
  result: Omit<SearchCrawlResult, "searchUrl"> & { searchUrl?: string }
): (keyword: string, limit?: number) => Promise<SearchCrawlResult> {
  return async () => ({ searchUrl: "https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=test", ...result });
}

function stubDetailCollector(byId: Record<string, { salePrice: number; normalPrice: number; name: string }>): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => {
    const idMatch = sourceUrl.match(/goodsNo=([A-Za-z0-9]+)/i);
    const id = idMatch ? idMatch[1].toUpperCase() : "";
    const spec = byId[id];
    if (!spec) {
      return { status: "PRODUCT_NOT_FOUND", sourceUrl, error: "테스트: 없는 상품", checkedAt: new Date().toISOString() };
    }
    return {
      status: "SUCCESS",
      sourceUrl,
      checkedAt: new Date().toISOString(),
      data: {
        oliveyoungProductId: id,
        name: spec.name,
        brand: "테스트 브랜드",
        imageUrl: null,
        normalPrice: spec.normalPrice,
        salePrice: spec.salePrice,
        discountRate: 0,
      },
    };
  };
}

async function main() {
  await test("extractGoodsNos: 상세페이지 링크들에서 goodsNo를 중복 없이, 순서대로 추출", () => {
    const html = `
      <a href="/store/goods/getGoodsDetail.do?goodsNo=A000000111111&dispCatNo=1">상품1</a>
      <a href="/store/goods/getGoodsDetail.do?goodsNo=a000000222222&trackingCd=x">상품2</a>
      <a href="/store/goods/getGoodsDetail.do?goodsNo=A000000111111">상품1 중복 링크</a>
    `;
    assert.deepEqual(extractGoodsNos(html, 10), ["A000000111111", "A000000222222"]);
  });

  await test("extractGoodsNos: limit을 넘지 않음", () => {
    const html = Array.from({ length: 5 }, (_, i) => `<a href="/store/goods/getGoodsDetail.do?goodsNo=G${i}">x</a>`).join("\n");
    assert.equal(extractGoodsNos(html, 2).length, 2);
  });

  await test("extractGoodsNos: 관련 링크가 없으면 빈 배열", () => {
    assert.deepEqual(extractGoodsNos("<html><body>결과 없음</body></html>", 5), []);
  });

  await test("검색 결과 없음(NO_MATCHES)이면 상품 없이 상태만 반환", async () => {
    const outcome = await crawlOliveYoungByKeyword(
      "존재하지않는키워드",
      3,
      stubSearch({ status: "NO_MATCHES", keyword: "존재하지않는키워드", goodsNos: [] })
    );
    assert.equal(outcome.status, "NO_MATCHES");
    assert.equal(outcome.products.length, 0);
  });

  await test("네트워크 차단(NETWORK_ERROR)이면 에러 메시지와 함께 실패로 반환", async () => {
    const outcome = await crawlOliveYoungByKeyword(
      "크림",
      3,
      stubSearch({ status: "NETWORK_ERROR", keyword: "크림", goodsNos: [], error: "차단됨" })
    );
    assert.equal(outcome.status, "NETWORK_ERROR");
    assert.equal(outcome.error, "차단됨");
  });

  await test("검색 성공 → 각 goodsNo를 실제 상품으로 수집/저장하되 추적은 하지 않음", async () => {
    const outcome = await crawlOliveYoungByKeyword(
      "크림",
      3,
      stubSearch({ status: "SUCCESS", keyword: "크림", goodsNos: ["CRAWL0001", "CRAWL0002"] }),
      stubDetailCollector({
        CRAWL0001: { salePrice: 19900, normalPrice: 22000, name: "크롤링 테스트 크림 1" },
        CRAWL0002: { salePrice: 15900, normalPrice: 15900, name: "크롤링 테스트 크림 2" },
      })
    );
    assert.equal(outcome.status, "SUCCESS");
    assert.equal(outcome.products.length, 2);
    assert.ok(await getProductById("CRAWL0001"));
    assert.equal((await getProductById("CRAWL0001"))!.salePrice, 19900);
    assert.equal(await countTrackers("CRAWL0001"), 0, "검색만 했을 뿐 아무도 추적 설정을 하지 않아야 함");
  });

  await test("검색은 됐지만 상세 수집이 전부 실패하면 실패로 반환", async () => {
    const outcome = await crawlOliveYoungByKeyword(
      "실패",
      3,
      stubSearch({ status: "SUCCESS", keyword: "실패", goodsNos: ["NOPE0001"] }),
      stubDetailCollector({})
    );
    assert.notEqual(outcome.status, "SUCCESS");
    assert.equal(outcome.products.length, 0);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
