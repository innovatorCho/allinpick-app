/**
 * Confirms collectors/oliveyoung/renderPage.ts's dispatch actually works end
 * to end through the REAL collector function (collectOliveYoungProduct),
 * not just the serverless fetcher in isolation (that was already proven by
 * test-serverless-crawl.ts). Sets `process.env.VERCEL = "1"` to force the
 * same branch a real Vercel deployment would take, then runs the exact
 * function productCollector.ts/priceScheduler.ts call for real.
 *
 * Must run inside the Docker test image (Dockerfile.serverless-test), same
 * reason as test-serverless-crawl.ts — @sparticuz/chromium's binary doesn't
 * execute on macOS/Windows at all.
 *
 *   npm run test:vercel-collector-dispatch
 */
process.env.VERCEL = "1";

import { collectOliveYoungProduct } from "@/collectors/oliveyoung/productCollector";

const url =
  process.argv[2] ?? "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000231545";

console.log(`[test-vercel-collector-dispatch] VERCEL=1 환경에서 실제 collectOliveYoungProduct() 호출 — ${url}`);
const startedAt = Date.now();
const result = await collectOliveYoungProduct(url);
const elapsedMs = Date.now() - startedAt;

console.log(JSON.stringify(result, null, 2));

if (result.status === "SUCCESS") {
  console.log(`✅ SUCCESS (${elapsedMs}ms) — renderPage.ts가 serverless 경로로 올바르게 분기했고, 실제 수집도 성공함`);
  process.exit(0);
} else {
  console.log(`❌ ${result.status} (${elapsedMs}ms) — ${result.error.split("\n")[0]}`);
  process.exit(1);
}
