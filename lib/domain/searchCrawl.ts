import { searchOliveYoungGoodsNos, goodsNoToSourceUrl } from "@/collectors/oliveyoung/searchCollector";
import type { SearchCrawlResult, SearchCrawlStatus } from "@/collectors/oliveyoung/searchCollector";
import { ensureProductCollected, type Collector } from "./collection";
import type { CollectStatus, Product } from "./types";

export type { SearchCrawlStatus };

/** Per-goodsNo outcome of the detail-page collection step, kept for on-screen diagnostics. */
export interface CrawlAttempt {
  goodsNo: string;
  status: CollectStatus;
  error?: string;
}

export interface KeywordCrawlOutcome {
  status: SearchCrawlStatus;
  error?: string;
  keyword: string;
  /** The exact URL requested for the search step — shown on screen so it can be checked manually. */
  searchUrl?: string;
  /** goodsNo values found on the search-results page, before per-product collection. */
  foundGoodsNos: string[];
  /** What happened trying to collect each of those goodsNo's own detail page. */
  attempts: CrawlAttempt[];
  products: Product[];
}

export type KeywordSearcher = (keyword: string, limit?: number) => Promise<SearchCrawlResult>;

/**
 * Fallback for a keyword search that found nothing locally (explicit user
 * request): looks the keyword up on OliveYoung itself, and for each product
 * found, collects and stores it the same way a URL registration would — so
 * it joins the shared catalog and the next search for it is instant, purely
 * local, no crawl needed (AGENTS.md §6/§11).
 *
 * Deliberately does not track the searching user against any of these —
 * browsing a search result is not the same as choosing to track it.
 *
 * Returns every intermediate step (search URL, goodsNo found, per-product
 * collection result) rather than just a final yes/no, so the search page can
 * show exactly what the crawl actually did.
 *
 * `searchFn`/`collector` default to the real OliveYoung network calls and
 * are only overridden by tests (see scripts/verify), same pattern as
 * collection.ts's `Collector`.
 */
export async function crawlOliveYoungByKeyword(
  keyword: string,
  limit = 3,
  searchFn: KeywordSearcher = searchOliveYoungGoodsNos,
  collector?: Collector
): Promise<KeywordCrawlOutcome> {
  const searchResult = await searchFn(keyword, limit);
  if (searchResult.status !== "SUCCESS") {
    return {
      status: searchResult.status,
      error: searchResult.error,
      keyword,
      searchUrl: searchResult.searchUrl,
      foundGoodsNos: [],
      attempts: [],
      products: [],
    };
  }

  const attempts: CrawlAttempt[] = [];
  const collected = await Promise.all(
    searchResult.goodsNos.map(async (goodsNo) => {
      try {
        const { product, collectResult } = await ensureProductCollected(goodsNoToSourceUrl(goodsNo), collector);
        attempts.push({
          goodsNo,
          status: collectResult.status,
          error: collectResult.status === "SUCCESS" ? undefined : collectResult.error,
        });
        return collectResult.status === "SUCCESS" ? product : null;
      } catch (err) {
        attempts.push({
          goodsNo,
          status: "FAILED",
          error: err instanceof Error ? err.message : "알 수 없는 오류",
        });
        return null;
      }
    })
  );

  const products = collected.filter((p): p is Product => p != null);
  const base = {
    keyword,
    searchUrl: searchResult.searchUrl,
    foundGoodsNos: searchResult.goodsNos,
    attempts,
  };

  if (products.length === 0) {
    return {
      ...base,
      status: "PARSER_ERROR",
      error: "올리브영 검색 결과에서 상품 ID는 찾았지만, 상세 정보 수집에 모두 실패했습니다.",
      products: [],
    };
  }

  return { ...base, status: "SUCCESS", products };
}
