import { buildCollectResultFromRenderedPage } from "./productCollector";
import { fetchRenderedHtmlServerlessResilient } from "./serverlessBrowserFetcher";
import type { CollectResult } from "./types";

/**
 * Admin-test-only twin of collectOliveYoungProduct (productCollector.ts) —
 * same parsing/error-mapping, but rendered via the serverless-sized Chromium
 * (serverlessBrowserFetcher.ts) instead of the proven Playwright one. Used
 * exclusively by the admin "서버리스 크롤러 테스트" tool to answer: would
 * this still work if the real collector were swapped for a Vercel-compatible
 * one? Never called from the real scheduler or registration flow.
 */
export async function collectOliveYoungProductServerless(sourceUrl: string): Promise<CollectResult> {
  const checkedAt = new Date().toISOString();

  let rendered: { html: string; status: number | null };
  try {
    rendered = await fetchRenderedHtmlServerlessResilient(sourceUrl);
  } catch (err) {
    return {
      status: "NETWORK_ERROR",
      sourceUrl,
      error: err instanceof Error ? err.message : "페이지 렌더링에 실패했습니다.",
      checkedAt,
    };
  }
  return buildCollectResultFromRenderedPage(rendered, sourceUrl, checkedAt);
}
