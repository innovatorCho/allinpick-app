/**
 * URL identification helpers for OliveYoung product links.
 *
 * The site identifies a product by the `goodsNo` query parameter
 * (e.g. `A000000198669`). We treat that value as the canonical
 * `oliveyoungProductId` — never the raw URL string — so the same product
 * registered through different URL variants (mobile domain, tracking
 * params, http/https, trailing slashes, or a short link — see
 * `resolveOliveYoungProductId` below) resolves to one Product row.
 */

const OLIVEYOUNG_HOST_SUFFIX = "oliveyoung.co.kr";
const SHORT_URL_TIMEOUT_MS = 8_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export class InvalidOliveYoungUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidOliveYoungUrlError";
  }
}

function isOliveYoungHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(OLIVEYOUNG_HOST_SUFFIX);
}

function extractGoodsNoFromUrl(url: URL): string {
  const goodsNo = url.searchParams.get("goodsNo");
  if (goodsNo && /^[A-Za-z0-9]+$/.test(goodsNo)) {
    return goodsNo.toUpperCase();
  }

  // Fallback: some shared links encode the id in the path segment.
  const pathMatch = url.pathname.match(/goodsNo[/=]([A-Za-z0-9]+)/i);
  if (pathMatch) {
    return pathMatch[1].toUpperCase();
  }

  throw new InvalidOliveYoungUrlError("상품 페이지 링크가 아니에요. 올리브영 상품 상세 페이지의 링크를 붙여넣어주세요.");
}

/** Throws if the URL isn't a parseable OliveYoung product URL. Synchronous — does not follow short links (see `resolveOliveYoungProductId`). */
export function extractOliveYoungProductId(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new InvalidOliveYoungUrlError("링크 형식이 올바르지 않아요. 올리브영 상품 링크를 다시 확인해주세요.");
  }

  if (!isOliveYoungHost(url.hostname)) {
    throw new InvalidOliveYoungUrlError("올리브영 상품 링크만 등록할 수 있어요.");
  }

  return extractGoodsNoFromUrl(url);
}

/**
 * Best-effort resolution of a non-OliveYoung URL as a short link that
 * redirects to one (e.g. `oy.run/...`, OliveYoung's own shortener). Returns
 * null on any failure — this is always a courtesy attempt, never a hard
 * requirement, so a broken/unreachable shortener just falls through to the
 * normal "not an OliveYoung URL" error rather than surfacing a network error
 * of its own.
 *
 * Two resolution strategies, since real shorteners vary:
 *  1. A standard HTTP redirect (`Location` header) — the generic case.
 *  2. oy.run's actual behavior (verified against a real link while building
 *     this): it responds 200 with the destination embedded in an inline
 *     `window.__SERVER_DATA__.targetUrl` script, not a redirect at all.
 *
 * Deliberately a single plain `fetch` — unlike the product/search collectors,
 * this never needs a real browser: oy.run's redirect page itself isn't
 * behind OliveYoung's Cloudflare challenge (confirmed manually), so there's
 * nothing here to "get past".
 */
/**
 * Pulls the destination URL out of oy.run's embedded `window.__SERVER_DATA__`
 * script blob. Exported for direct unit testing (see
 * scripts/verify/test-short-url.ts) against a real captured sample, without
 * needing a live network call in the test suite.
 */
export function parseEmbeddedTargetUrl(html: string): string | null {
  const match = html.match(/"targetUrl"\s*:\s*"([^"]+)"/);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`); // undo JSON string-escaping (e.g. \/) in the embedded blob
  } catch {
    return match[1].replace(/\\\//g, "/");
  }
}

async function tryResolveShortUrl(rawUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SHORT_URL_TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
    });

    const location = res.headers.get("location");
    if (location) {
      try {
        return new URL(location, rawUrl).toString();
      } catch {
        // fall through to body inspection
      }
    }

    const html = await res.text();
    return parseEmbeddedTargetUrl(html);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Like `extractOliveYoungProductId`, but if the URL isn't directly on
 * oliveyoung.co.kr, tries resolving it as a short link first. Async because
 * that resolution needs a network request; use the synchronous version when
 * the URL is already known to be a direct OliveYoung link.
 */
export async function resolveOliveYoungProductId(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new InvalidOliveYoungUrlError("링크 형식이 올바르지 않아요. 올리브영 상품 링크를 다시 확인해주세요.");
  }

  if (isOliveYoungHost(url.hostname)) {
    return extractGoodsNoFromUrl(url);
  }

  const resolvedUrl = await tryResolveShortUrl(rawUrl);
  if (resolvedUrl) {
    try {
      const resolved = new URL(resolvedUrl);
      if (isOliveYoungHost(resolved.hostname)) {
        return extractGoodsNoFromUrl(resolved);
      }
    } catch {
      // resolvedUrl wasn't a valid URL — fall through to the error below
    }
  }

  throw new InvalidOliveYoungUrlError(
    "올리브영 상품 링크만 등록할 수 있어요. 올리브영 앱의 공유 링크도 사용할 수 있어요."
  );
}

/** Canonical PC product-detail URL used for actual collection requests. */
export function toCanonicalSourceUrl(oliveyoungProductId: string): string {
  return `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${oliveyoungProductId}`;
}
