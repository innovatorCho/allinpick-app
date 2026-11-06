import type { CollectStatus } from "@/lib/domain/types";

export const COLLECT_STATUS_LABELS: Record<CollectStatus, string> = {
  SUCCESS: "정상",
  FAILED: "수집 실패",
  PRODUCT_NOT_FOUND: "상품 없음",
  PRICE_NOT_FOUND: "가격 정보 없음",
  PARSER_ERROR: "파싱 오류",
  NETWORK_ERROR: "네트워크 오류",
  BOT_BLOCKED: "차단됨 (Cloudflare)",
};

export function collectStatusLabel(status: CollectStatus | null): string {
  if (!status) return "수집 전";
  return COLLECT_STATUS_LABELS[status] ?? status;
}

/** Shown in place of a product's name while its details are still being fetched. */
export const AWAITING_INFO_LABEL = "상품 정보를 가져오는 중";

/**
 * Registered, but no collection has succeeded yet, so name, image and price
 * are still placeholders (a successful collection always sets sale_price).
 */
export function isAwaitingFirstCollection(product: { salePrice: number | null }): boolean {
  return product.salePrice == null;
}
