/**
 * OliveYoung keyword-search collector.
 *
 * Used only as a fallback when a search finds nothing in our own DB
 * (AGENTS.md's internal-only search stays the default — this crawls live
 * only on a miss, per explicit user request).
 *
 * Uses a real headless browser (renderPage.ts, which picks the right
 * Chromium for wherever this runs) for the same reason as productCollector.ts:
 * a plain fetch never gets past OliveYoung's Cloudflare JS challenge.
 * Verified against a real search-results page while building this — the
 * goodsNo-extraction regex below matched real product links as-is, no
 * changes needed once the page could actually be reached.
 */
import { toCanonicalSourceUrl } from "./identify";
import { fetchRenderedHtmlResilient, isBotChallengePage } from "./renderPage";

export type SearchCrawlStatus = "SUCCESS" | "NO_MATCHES" | "NETWORK_ERROR" | "PARSER_ERROR";

export interface SearchCrawlResult {
  status: SearchCrawlStatus;
  keyword: string;
  searchUrl: string;
  goodsNos: string[];
  error?: string;
}

function searchUrlFor(keyword: string): string {
  return `https://www.oliveyoung.co.kr/store/search/getSearchMain.do?query=${encodeURIComponent(keyword)}`;
}

/**
 * Pulls distinct product ids out of a search-results page's raw HTML, order
 * of first appearance. Exported for direct unit testing (see
 * scripts/verify/test-search-crawl.ts). Verified against a real search page.
 */
export function extractGoodsNos(html: string, limit: number): string[] {
  const seen = new Set<string>();
  const pattern = /getGoodsDetail\.do\?[^"'>\s]*goodsNo=([A-Za-z0-9]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && seen.size < limit) {
    seen.add(match[1].toUpperCase());
  }
  return Array.from(seen);
}

export async function searchOliveYoungGoodsNos(keyword: string, limit = 3): Promise<SearchCrawlResult> {
  const url = searchUrlFor(keyword);

  let html: string;
  try {
    const rendered = await fetchRenderedHtmlResilient(url);
    html = rendered.html;
  } catch (err) {
    return {
      status: "NETWORK_ERROR",
      keyword,
      searchUrl: url,
      goodsNos: [],
      error: err instanceof Error ? err.message : "페이지 렌더링에 실패했습니다.",
    };
  }

  if (isBotChallengePage(html)) {
    return {
      status: "NETWORK_ERROR",
      keyword,
      searchUrl: url,
      goodsNos: [],
      error: "올리브영 서버가 자동화된 요청을 차단했습니다 (Cloudflare 봇 차단 페이지 감지).",
    };
  }

  let goodsNos: string[];
  try {
    goodsNos = extractGoodsNos(html, limit);
  } catch (err) {
    return {
      status: "PARSER_ERROR",
      keyword,
      searchUrl: url,
      goodsNos: [],
      error: err instanceof Error ? err.message : "검색 결과 페이지를 해석할 수 없습니다.",
    };
  }

  if (goodsNos.length === 0) {
    return { status: "NO_MATCHES", keyword, searchUrl: url, goodsNos: [] };
  }

  return { status: "SUCCESS", keyword, searchUrl: url, goodsNos };
}

export function goodsNoToSourceUrl(goodsNo: string): string {
  return toCanonicalSourceUrl(goodsNo);
}
