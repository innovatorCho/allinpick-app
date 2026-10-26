/**
 * Unit tests for short-URL resolution (collectors/oliveyoung/identify.ts).
 * The HTML fixture below is the real response body captured from an actual
 * oy.run link while building this (see chat history) — network itself isn't
 * exercised here, only the parsing logic that matters.
 *
 * Run with:
 *   node --experimental-strip-types --import ./scripts/verify/register.mjs \
 *     scripts/verify/test-short-url.ts
 */
import assert from "node:assert/strict";
import {
  extractOliveYoungProductId,
  resolveOliveYoungProductId,
  parseEmbeddedTargetUrl,
  InvalidOliveYoungUrlError,
} from "@/collectors/oliveyoung/identify";

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

// Real captured response body from https://oy.run/ZrZGyy3BxRPsDj (see chat history).
const OY_RUN_SAMPLE_HTML = `<!DOCTYPE html>
<html>
  <head><meta name="facebook-domain-verification" content="5mlgwehrl4nwg5cfdnjnxlitrxtwjq" /><script>window.__SERVER_DATA__={"targetUrl":"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000231545","status":200,"isAppOnlyUrl":false,"isBlockedUrl":false,"isBrowserOnlyUrl":false,"shortenedUrl":"https://oy.run/ZrZGyy3BxRPsDj","linkName":""}</script></head>
  <body><div id="root"></div></body>
</html>`;

async function main() {
  await test("parseEmbeddedTargetUrl: 실제 oy.run 응답 본문에서 targetUrl 추출 (실 데이터)", () => {
    assert.equal(
      parseEmbeddedTargetUrl(OY_RUN_SAMPLE_HTML),
      "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000231545"
    );
  });

  await test("parseEmbeddedTargetUrl: 이스케이프된 슬래시(\\/)도 정상 복원", () => {
    const html = `<script>window.__SERVER_DATA__={"targetUrl":"https:\\/\\/www.oliveyoung.co.kr\\/store\\/goods\\/getGoodsDetail.do?goodsNo=A000000999999"}</script>`;
    assert.equal(
      parseEmbeddedTargetUrl(html),
      "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000999999"
    );
  });

  await test("parseEmbeddedTargetUrl: targetUrl이 없으면 null", () => {
    assert.equal(parseEmbeddedTargetUrl("<html><body>no data here</body></html>"), null);
  });

  await test("resolveOliveYoungProductId: 이미 올리브영 URL이면 네트워크 없이 즉시 추출", async () => {
    const id = await resolveOliveYoungProductId(
      "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000263035"
    );
    assert.equal(id, "A000000263035");
  });

  await test("resolveOliveYoungProductId: 완전히 잘못된 URL 문자열은 네트워크 시도 없이 즉시 거부", async () => {
    await assert.rejects(() => resolveOliveYoungProductId("이건 URL이 아님"), InvalidOliveYoungUrlError);
  });

  await test("extractOliveYoungProductId(동기): 여전히 정상 동작 — 짧은 URL은 지원하지 않음(이건 async 버전만 지원)", () => {
    assert.throws(() => extractOliveYoungProductId("https://oy.run/ZrZGyy3BxRPsDj"), InvalidOliveYoungUrlError);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
