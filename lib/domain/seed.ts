import { getDb } from "@/lib/db/client";
import { insertSeedProduct } from "./products";
import { insertPriceHistory } from "./priceHistory";
import { trackProduct, setTargetPrice } from "./tracking";
import { createNotification } from "./notifications";
import type { PriceChangeType } from "./types";

/**
 * Dev-only sample data generator (AGENTS.md §16). Never used in production —
 * callers must gate this behind `process.env.NODE_ENV !== "production"`
 * themselves (enforced again here as a second guard).
 *
 * Every row this creates is flagged `is_seed = 1` on the product, and every
 * seed-authored notification message is suffixed "(샘플 데이터)" so it's
 * never confused with a real collection result (AGENTS.md §8).
 */

function daysAgoIso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

interface SeedSpec {
  id: string;
  name: string;
  brand: string;
  normalPrice: number;
  /** Oldest → newest sale price per day. Length = days of history to backfill. */
  priceSeries: number[];
  trackers: { userId: string; targetPrice?: number }[];
}

const SEED_SPECS: SeedSpec[] = [
  {
    id: "SEED0001",
    name: "레드 블레미쉬 클리어 수딩 크림",
    brand: "닥터지",
    normalPrice: 32000,
    priceSeries: [32000, 32000, 29900, 29900, 27900, 26900, 22400],
    trackers: [{ userId: "user-a", targetPrice: 25000 }, { userId: "user-b" }, { userId: "user-c" }],
  },
  {
    id: "SEED0002",
    name: "자작나무 수분 크림",
    brand: "라운드랩",
    normalPrice: 27000,
    priceSeries: [27000, 25900, 25900, 24500, 24500, 22000, 21000],
    trackers: [{ userId: "user-a" }, { userId: "user-b", targetPrice: 21500 }],
  },
  {
    id: "SEED0003",
    name: "어성초 77 스킨부스터",
    brand: "아누아",
    normalPrice: 25000,
    priceSeries: [25000, 25000, 23900, 23900, 23900, 20900, 18900],
    trackers: [{ userId: "user-b" }],
  },
  {
    id: "SEED0004",
    name: "마스크핏 레드쿠션",
    brand: "티르티르",
    normalPrice: 29000,
    priceSeries: [29000, 29000, 29000, 26900, 26900, 26900, 24900],
    trackers: [{ userId: "user-c" }],
  },
  {
    id: "SEED0005",
    name: "청귤 비타C 세럼",
    brand: "구달",
    normalPrice: 23000,
    priceSeries: [21900], // registered "yesterday" — not enough history for a 7-day graph yet
    trackers: [{ userId: "user-a" }],
  },
  {
    id: "SEED0006",
    name: "마데카소사이드 앰플 마스크",
    brand: "메디힐",
    normalPrice: 15000,
    priceSeries: [15000, 13900, 12900],
    trackers: [{ userId: "user-b" }, { userId: "user-c" }],
  },
  {
    id: "SEED0007",
    name: "쥬시래스팅 틴트",
    brand: "롬앤",
    normalPrice: 12000,
    priceSeries: [12000, 12000, 10900, 10900, 10900, 10900, 9900],
    trackers: [],
  },
  {
    id: "SEED0008",
    name: "그린티 씨드 세럼",
    brand: "이니스프리",
    normalPrice: 28000,
    priceSeries: [28000, 26000, 26000, 24000, 24000, 24000, 22800],
    trackers: [{ userId: "user-a" }],
  },
  {
    id: "SEED0009",
    name: "다이브인 히알루론산 세럼",
    brand: "토리든",
    normalPrice: 19000,
    priceSeries: [19000, 19000, 17900, 17900, 16900, 16900, 15900],
    trackers: [{ userId: "user-c" }, { userId: "user-a" }],
  },
  {
    id: "SEED0010",
    name: "병풀 안심 마일드 선크림",
    brand: "브링그린",
    normalPrice: 18000,
    priceSeries: [18000, 18000, 16500, 16500, 16500, 15500, 15500],
    trackers: [],
  },
];

export async function hasSeedData(): Promise<boolean> {
  const db = await getDb();
  const row = (await db.prepare(`SELECT COUNT(*) AS cnt FROM products WHERE is_seed = 1`).get()) as {
    cnt: number;
  };
  return row.cnt > 0;
}

export interface SeedSummary {
  productsCreated: number;
  priceHistoryRowsCreated: number;
  trackingRowsCreated: number;
  notificationsCreated: number;
}

export async function generateSampleData(): Promise<SeedSummary> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("샘플 데이터 생성은 개발 환경에서만 사용할 수 있습니다.");
  }
  // Idempotent: a second click just no-ops instead of duplicating history/tracking rows.
  if (await hasSeedData()) {
    return { productsCreated: 0, priceHistoryRowsCreated: 0, trackingRowsCreated: 0, notificationsCreated: 0 };
  }

  let priceHistoryRowsCreated = 0;
  let trackingRowsCreated = 0;
  let notificationsCreated = 0;

  for (const spec of SEED_SPECS) {
    const days = spec.priceSeries.length;
    const lastPrice = spec.priceSeries[days - 1];
    const discountRate =
      spec.normalPrice > lastPrice
        ? Math.round(((spec.normalPrice - lastPrice) / spec.normalPrice) * 100)
        : 0;

    await insertSeedProduct({
      id: spec.id,
      name: spec.name,
      brand: spec.brand,
      imageUrl: null,
      sourceUrl: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${spec.id}`,
      normalPrice: spec.normalPrice,
      salePrice: lastPrice,
      discountRate,
      lastCheckedAt: daysAgoIso(0),
    });

    let previous: number | null = null;
    for (const [index, price] of spec.priceSeries.entries()) {
      const changeType: PriceChangeType =
        previous == null ? "initial" : price < previous ? "decrease" : price > previous ? "increase" : "same";
      if (changeType !== "same") {
        await insertPriceHistory({
          productId: spec.id,
          price,
          changeType,
          recordedAt: daysAgoIso(days - 1 - index),
          source: "seed",
        });
        priceHistoryRowsCreated += 1;
      }
      previous = price;
    }

    for (const tracker of spec.trackers) {
      await trackProduct(tracker.userId, spec.id);
      trackingRowsCreated += 1;
      if (tracker.targetPrice != null) {
        await setTargetPrice(tracker.userId, spec.id, tracker.targetPrice);
        if (lastPrice <= tracker.targetPrice) {
          await createNotification({
            userId: tracker.userId,
            productId: spec.id,
            type: "target_price",
            message: `목표 가격 ${tracker.targetPrice.toLocaleString("ko-KR")}원 이하입니다. (현재 ${lastPrice.toLocaleString("ko-KR")}원) (샘플 데이터)`,
            oldPrice: null,
            newPrice: lastPrice,
          });
          notificationsCreated += 1;
        }
      }
    }

    // Give the flagship product (SEED0001) a clear price-drop notification
    // so the alerts screen has something to show without a live collection.
    if (spec.id === "SEED0001") {
      const secondLast = spec.priceSeries[days - 2];
      for (const tracker of spec.trackers) {
        await createNotification({
          userId: tracker.userId,
          productId: spec.id,
          type: "price_drop",
          message: `${secondLast.toLocaleString("ko-KR")}원 → ${lastPrice.toLocaleString("ko-KR")}원, ${(secondLast - lastPrice).toLocaleString("ko-KR")}원 하락했습니다. (샘플 데이터)`,
          oldPrice: secondLast,
          newPrice: lastPrice,
        });
        notificationsCreated += 1;
      }
    }
  }

  return {
    productsCreated: SEED_SPECS.length,
    priceHistoryRowsCreated,
    trackingRowsCreated,
    notificationsCreated,
  };
}
