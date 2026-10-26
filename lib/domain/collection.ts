import {
  resolveOliveYoungProductId,
  InvalidOliveYoungUrlError,
  toCanonicalSourceUrl,
} from "@/collectors/oliveyoung/identify";
import { collectOliveYoungProduct } from "@/collectors/oliveyoung/productCollector";
import type { CollectResult } from "@/collectors/oliveyoung/types";
import { formatKrw } from "@/lib/format";
import {
  countTrackers,
  createPlaceholderProduct,
  getProductById,
  recordCollectionFailure,
  updateProductMetadataAndPrice,
  updateSchedulingMeta,
} from "./products";
import { insertCollectLog, insertPriceHistory } from "./priceHistory";
import { listTrackersForProduct, setTargetPrice, trackProduct } from "./tracking";
import { createNotification } from "./notifications";
import { computeNextSchedule } from "./collectionSchedule";
import { getConfiguredIntervalMs } from "./schedulerSettings";
import type { Product, PriceChangeType } from "./types";

export { InvalidOliveYoungUrlError };

export interface CollectionOutcome {
  collectResult: CollectResult;
  changeType: PriceChangeType | null;
}

export interface RegisterProductResult extends CollectionOutcome {
  product: Product;
}

/** A collector function has this shape — `collectOliveYoungProduct` in production, a stub in tests. */
export type Collector = (sourceUrl: string) => Promise<CollectResult>;

/**
 * Ensures a product exists locally for this URL and runs one collection
 * attempt, WITHOUT tracking it for any user. Used both by registration
 * (which tracks the registering user right after) and by keyword-search
 * crawling (which should populate the shared product catalog without
 * silently subscribing the searcher to everything it finds).
 *
 * `collector` defaults to the real OliveYoung collector and is only ever
 * overridden by tests (see scripts/verify) so price-comparison/notification
 * logic can be exercised with deterministic results, independent of network
 * access.
 */
export async function ensureProductCollected(
  sourceUrl: string,
  collector: Collector = collectOliveYoungProduct
): Promise<RegisterProductResult> {
  const productId = await resolveOliveYoungProductId(sourceUrl);
  const canonicalUrl = toCanonicalSourceUrl(productId);

  if (!(await getProductById(productId))) {
    await createPlaceholderProduct({ id: productId, sourceUrl: canonicalUrl });
  }

  const outcome = await runCollection(productId, collector);
  return { product: (await getProductById(productId))!, ...outcome };
}

/**
 * Registers a product from a URL for a user, or links the user to the
 * existing product if it's already tracked by someone else (AGENTS.md §6,
 * TEST1/TEST2). A single collection attempt runs immediately so the caller
 * has fresh data (or a clear failure reason) to show right away.
 */
export async function registerProductForUser(
  sourceUrl: string,
  userId: string,
  collector: Collector = collectOliveYoungProduct
): Promise<RegisterProductResult> {
  const result = await ensureProductCollected(sourceUrl, collector);
  await trackProduct(userId, result.product.id);
  return result;
}

/** Manually re-runs collection for an already-registered product (admin "가격 다시 확인"). */
export async function recollectProduct(
  productId: string,
  collector: Collector = collectOliveYoungProduct
): Promise<CollectionOutcome> {
  if (!(await getProductById(productId))) {
    throw new Error("존재하지 않는 상품입니다.");
  }
  return runCollection(productId, collector);
}

async function runCollection(productId: string, collector: Collector): Promise<CollectionOutcome> {
  const product = (await getProductById(productId))!;
  const collectResult = await collector(product.sourceUrl);

  await insertCollectLog({
    productId,
    status: collectResult.status,
    errorMessage: collectResult.status === "SUCCESS" ? null : collectResult.error,
    createdAt: collectResult.checkedAt,
  });

  const baseIntervalMs = await getConfiguredIntervalMs();
  const trackerCount = await countTrackers(productId);

  if (collectResult.status !== "SUCCESS") {
    // Existing price is intentionally left untouched — a failed collection
    // is a normal outcome, not data loss (AGENTS.md §4, TEST5).
    await recordCollectionFailure(productId, collectResult.status, collectResult.error, collectResult.checkedAt);
    await updateSchedulingMeta(
      productId,
      computeNextSchedule({
        baseIntervalMs,
        trackerCount,
        changeType: null,
        priorConsecutiveFailures: product.consecutiveFailures,
        priorConsecutiveSameCount: product.consecutiveSameCount,
      })
    );
    return { collectResult, changeType: null };
  }

  const { data, checkedAt } = collectResult;
  const previousSalePrice = product.salePrice;
  const changeType: PriceChangeType =
    previousSalePrice == null
      ? "initial"
      : data.salePrice < previousSalePrice
        ? "decrease"
        : data.salePrice > previousSalePrice
          ? "increase"
          : "same";

  await updateProductMetadataAndPrice(productId, {
    name: data.name,
    brand: data.brand,
    imageUrl: data.imageUrl,
    normalPrice: data.normalPrice,
    salePrice: data.salePrice,
    discountRate: data.discountRate,
    lastCheckedAt: checkedAt,
  });

  // Repeated identical prices only advance lastCheckedAt, never price_history (AGENTS.md §7, TEST4).
  if (changeType !== "same") {
    await insertPriceHistory({
      productId,
      price: data.salePrice,
      changeType,
      recordedAt: checkedAt,
      source: "collector",
    });
  }

  if (changeType === "decrease" && previousSalePrice != null) {
    await notifyPriceDrop(productId, previousSalePrice, data.salePrice);
  }

  await updateSchedulingMeta(
    productId,
    computeNextSchedule({
      baseIntervalMs,
      trackerCount,
      changeType,
      priorConsecutiveFailures: product.consecutiveFailures,
      priorConsecutiveSameCount: product.consecutiveSameCount,
    })
  );

  return { collectResult, changeType };
}

async function notifyPriceDrop(productId: string, oldPrice: number, newPrice: number): Promise<void> {
  const drop = oldPrice - newPrice;
  for (const tracking of await listTrackersForProduct(productId)) {
    await createNotification({
      userId: tracking.userId,
      productId,
      type: "price_drop",
      message: `${formatKrw(oldPrice)} → ${formatKrw(newPrice)}, ${formatKrw(drop)} 하락했습니다.`,
      oldPrice,
      newPrice,
      sendKakao: true,
    });
    if (tracking.targetPrice != null && newPrice <= tracking.targetPrice) {
      await createNotification({
        userId: tracking.userId,
        productId,
        type: "target_price",
        message: `목표 가격 ${formatKrw(tracking.targetPrice)} 이하로 내려갔습니다. (현재 ${formatKrw(newPrice)})`,
        oldPrice,
        newPrice,
        targetPrice: tracking.targetPrice,
        sendKakao: true,
      });
    }
  }
}

/** Sets a tracker's target price and immediately notifies if it's already met (AGENTS.md §10). */
export async function setTargetPriceForUser(userId: string, productId: string, targetPrice: number): Promise<void> {
  await setTargetPrice(userId, productId, targetPrice);
  const product = await getProductById(productId);
  if (product?.salePrice != null && product.salePrice <= targetPrice) {
    await createNotification({
      userId,
      productId,
      type: "target_price",
      message: `목표 가격 ${formatKrw(targetPrice)} 이하입니다. (현재 ${formatKrw(product.salePrice)})`,
      oldPrice: null,
      newPrice: product.salePrice,
      targetPrice,
      sendKakao: true,
    });
  }
}
