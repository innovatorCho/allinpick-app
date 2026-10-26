/**
 * OliveYoung collector — shared types.
 *
 * This module intentionally has zero UI or database dependencies so it can be
 * reused (or swapped) independently of the rest of the app.
 */

/** Outcome of a single collection attempt. Failure is a normal, expected state. */
export type CollectStatus =
  | "SUCCESS"
  | "FAILED"
  | "PRODUCT_NOT_FOUND"
  | "PRICE_NOT_FOUND"
  | "PARSER_ERROR"
  | "NETWORK_ERROR"
  // Distinct from NETWORK_ERROR on purpose: a generic timeout/DNS failure is
  // probably a one-off blip, but Cloudflare's own interstitial actually
  // rendering back to us is a much stronger "this IP is currently under
  // suspicion" signal — confirmed for real (see chat history: a forced-due
  // burst got the whole IP blocked for a sustained window, not a single
  // request). lib/priceScheduler.ts's circuit breaker reacts to this status
  // specifically, not to NETWORK_ERROR in general.
  | "BOT_BLOCKED";

/** Fields extracted from an OliveYoung product page. */
export interface ParsedProduct {
  oliveyoungProductId: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  normalPrice: number;
  salePrice: number;
  discountRate: number;
}

/** Result of attempting to collect a product's info/price from a source URL. */
export type CollectResult =
  | {
      status: "SUCCESS";
      sourceUrl: string;
      data: ParsedProduct;
      checkedAt: string;
    }
  | {
      status: Exclude<CollectStatus, "SUCCESS">;
      sourceUrl: string;
      error: string;
      checkedAt: string;
    };
