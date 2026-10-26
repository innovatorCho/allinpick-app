import { parseProductHtml } from "./parser";
import { ParserError, PriceNotFoundError, ProductNotFoundError } from "./errors";
import { fetchRenderedHtmlResilient, isBotChallengePage } from "./renderPage";
import type { CollectResult } from "./types";

/**
 * Fetches an OliveYoung product page and extracts product/price info.
 *
 * A failed collection is a normal, expected outcome (see AGENTS spec §4):
 * it is returned as a typed result, never thrown, so callers can keep the
 * product's last known price untouched and just record the failure.
 *
 * Uses a real headless browser (browserFetcher.ts), not a plain fetch — a
 * plain fetch always receives OliveYoung's Cloudflare JS challenge page
 * instead of the real content (confirmed repeatedly). The bot-challenge
 * check below is kept as a safety net in case the challenge ever isn't
 * cleared (e.g. a harder variant), so that case is still reported clearly
 * rather than misparsed as a successful empty result.
 */
export async function collectOliveYoungProduct(sourceUrl: string): Promise<CollectResult> {
  const checkedAt = new Date().toISOString();

  let rendered: { html: string; status: number | null };
  try {
    rendered = await fetchRenderedHtmlResilient(sourceUrl);
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

/**
 * Turns an already-rendered page into a CollectResult — split out so the
 * admin-only serverless-crawler test tool (serverlessProductCollector.ts)
 * can reuse this exact parsing/error-mapping logic without duplicating it;
 * it only differs from collectOliveYoungProduct in *how* the page gets
 * rendered (a different browser fetcher), not in what happens afterward.
 */
export function buildCollectResultFromRenderedPage(
  rendered: { html: string; status: number | null },
  sourceUrl: string,
  checkedAt: string
): CollectResult {
  const { html } = rendered;

  if (isBotChallengePage(html)) {
    return {
      status: "BOT_BLOCKED",
      sourceUrl,
      error: "올리브영 서버가 자동화된 요청을 차단했습니다 (Cloudflare 봇 차단 페이지 감지).",
      checkedAt,
    };
  }

  if (rendered.status != null && rendered.status >= 400) {
    return {
      status: "NETWORK_ERROR",
      sourceUrl,
      error: `상품 페이지 요청이 실패했습니다 (HTTP ${rendered.status}).`,
      checkedAt,
    };
  }

  try {
    const data = parseProductHtml(html, sourceUrl);
    if (!data.oliveyoungProductId) {
      return {
        status: "PARSER_ERROR",
        sourceUrl,
        error: "URL에서 상품 ID를 확인할 수 없습니다.",
        checkedAt,
      };
    }
    return { status: "SUCCESS", sourceUrl, data, checkedAt };
  } catch (err) {
    return { status: mapParseErrorToStatus(err), sourceUrl, error: describeError(err), checkedAt };
  }
}

function mapParseErrorToStatus(err: unknown) {
  if (err instanceof ProductNotFoundError) return "PRODUCT_NOT_FOUND" as const;
  if (err instanceof PriceNotFoundError) return "PRICE_NOT_FOUND" as const;
  if (err instanceof ParserError) return "PARSER_ERROR" as const;
  return "PARSER_ERROR" as const;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : "알 수 없는 오류가 발생했습니다.";
}
