/**
 * Dev-only tool — exercises collectors/oliveyoung/serverlessProductCollector.ts
 * (the @sparticuz/chromium collector built for a possible future Vercel
 * migration) against one or more real OliveYoung product URLs.
 *
 * Must be run INSIDE the Docker test image (Dockerfile.serverless-test) —
 * that collector's browser binary targets AWS Lambda's Amazon-Linux-based
 * runtime and will not execute at all on a plain macOS/Windows dev machine
 * (confirmed: `spawn ENOEXEC`). Running this file directly with `npm run
 * dev`'s Node process just reproduces that failure — see
 * npm run test:serverless-crawl instead, which runs it in the container.
 *
 * Not part of the `npm run verify` suite on purpose: it makes real network
 * requests to oliveyoung.co.kr and depends on Docker being installed/running,
 * neither of which fits the verify suite's "fast, deterministic, no Docker
 * required" contract.
 */
import { buildCollectResultFromRenderedPage } from "@/collectors/oliveyoung/productCollector";
import { fetchRenderedHtmlServerlessResilient } from "@/collectors/oliveyoung/serverlessBrowserFetcher";
import type { CollectResult } from "@/collectors/oliveyoung/types";

// A spread of previously-verified real products — used when no URL is passed
// on the command line, so "just run it" still exercises more than one page.
const DEFAULT_URLS = [
  "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000231545",
  "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000247726",
  "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000263035",
];

// Longer than collectOliveYoungProductServerless's 20s default — that default
// is tied to the Vercel route's maxDuration budget (serverlessProductCollector.ts),
// but this script only runs locally under QEMU emulation, which is slower and
// has no such budget. Not calling collectOliveYoungProductServerless directly
// so the real (Vercel-bound) default stays untouched.
const TIMEOUT_MS = 40_000;

// Independent of the above — confirmed empirically (container ran for 11+
// minutes on one product with the chromium process still alive the whole
// time) that Playwright's own `timeout` option is NOT reliably enforced
// under Docker Desktop's Rosetta-accelerated x86_64-on-arm64 emulation. This
// is a last-resort ceiling so one stuck product can never hang the whole
// script — not a replacement for fixing the real timeout, just a backstop.
const HARD_TIMEOUT_MS = TIMEOUT_MS * 2 + 15_000;

const urls = process.argv.slice(2);
const targets = urls.length > 0 ? urls : DEFAULT_URLS;

async function testOne(url: string): Promise<{ url: string; elapsedMs: number; result: CollectResult }> {
  const checkedAt = new Date().toISOString();
  const startedAt = Date.now();

  const work = (async (): Promise<CollectResult> => {
    const rendered = await fetchRenderedHtmlServerlessResilient(url, TIMEOUT_MS);
    return buildCollectResultFromRenderedPage(rendered, url, checkedAt);
  })();

  const hardTimeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`하드 타임아웃: ${HARD_TIMEOUT_MS}ms 안에 응답이 없어 강제로 다음 상품으로 넘어갑니다.`)),
      HARD_TIMEOUT_MS
    );
  });

  try {
    const result = await Promise.race([work, hardTimeout]);
    return { url, elapsedMs: Date.now() - startedAt, result };
  } catch (err) {
    return {
      url,
      elapsedMs: Date.now() - startedAt,
      result: {
        status: "NETWORK_ERROR",
        sourceUrl: url,
        error: err instanceof Error ? err.message : "페이지 렌더링에 실패했습니다.",
        checkedAt,
      },
    };
  }
}

console.log(`[test-serverless-crawl] ${targets.length}개 상품 순차 테스트 시작\n`);

const runs: { url: string; elapsedMs: number; result: CollectResult }[] = [];
for (const [i, url] of targets.entries()) {
  console.log(`--- [${i + 1}/${targets.length}] ${url}`);
  const run = await testOne(url);
  runs.push(run);

  if (run.result.status === "SUCCESS") {
    console.log(`    ✅ SUCCESS (${run.elapsedMs}ms) — ${run.result.data.name} — ${run.result.data.salePrice.toLocaleString("ko-KR")}원`);
  } else {
    const blocked = run.result.error.includes("Cloudflare");
    console.log(`    ❌ ${run.result.status}${blocked ? " (Cloudflare 차단)" : ""} (${run.elapsedMs}ms) — ${run.result.error.split("\n")[0]}`);
  }
  console.log();
}

const successCount = runs.filter((r) => r.result.status === "SUCCESS").length;
const averageElapsedMs = Math.round(runs.reduce((sum, r) => sum + r.elapsedMs, 0) / runs.length);

console.log("=== 요약 ===");
console.log(`성공 ${successCount}/${runs.length} · 평균 ${averageElapsedMs}ms`);
console.log(JSON.stringify(runs, null, 2));

// A product that hit the hard timeout above leaves its browser launch still
// pending in the background (Promise.race doesn't cancel the loser) — that
// dangling handle would otherwise keep the process alive indefinitely.
// Explicit exit guarantees this script (and so `docker run`) always ends.
process.exit(successCount < runs.length ? 1 : 0);
