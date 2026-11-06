import { getDb } from "@/lib/db/client";
import type { ProductRow } from "@/lib/db/rows";
import type { Product, ProductWithPopularity } from "./types";

function toProduct(row: ProductRow): Product {
  return {
    id: row.oliveyoung_product_id,
    name: row.name,
    brand: row.brand,
    imageUrl: row.image_url,
    sourceUrl: row.source_url,
    curatorUrl: row.curator_url,
    normalPrice: row.normal_price,
    salePrice: row.sale_price,
    discountRate: row.discount_rate,
    lastCheckedAt: row.last_checked_at,
    lastCollectStatus: row.last_collect_status as Product["lastCollectStatus"],
    lastCollectError: row.last_collect_error,
    searchCount: row.search_count,
    viewCount: row.view_count,
    isSeed: row.is_seed === 1,
    nextCheckAt: row.next_check_at,
    consecutiveFailures: row.consecutive_failures,
    consecutiveSameCount: row.consecutive_same_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getProductById(id: string): Promise<Product | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT * FROM products WHERE oliveyoung_product_id = ?`)
    .get(id)) as ProductRow | undefined;
  return row ? toProduct(row) : null;
}

export async function listAllProducts(): Promise<Product[]> {
  const db = await getDb();
  const rows = (await db.prepare(`SELECT * FROM products ORDER BY updated_at DESC`).all()) as unknown as ProductRow[];
  return rows.map(toProduct);
}

/** Creates a placeholder row for a newly-registered product before the first collection result is known. */
export async function createPlaceholderProduct(input: { id: string; sourceUrl: string }): Promise<Product> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO products (
      oliveyoung_product_id, name, brand, image_url, source_url, curator_url,
      normal_price, sale_price, discount_rate,
      last_checked_at, last_collect_status, last_collect_error,
      search_count, view_count, is_seed, created_at, updated_at
    ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, 0, ?, ?)`
    )
    .run(input.id, "상품 정보 확인 중", "확인 중", input.sourceUrl, now, now);
  return (await getProductById(input.id))!;
}

/** Inserts a fully-formed sample product for dev-only test data generation (AGENTS.md §16), clearly flagged via is_seed. */
export async function insertSeedProduct(input: {
  id: string;
  name: string;
  brand: string;
  imageUrl: string | null;
  sourceUrl: string;
  normalPrice: number;
  salePrice: number;
  discountRate: number;
  lastCheckedAt: string;
}): Promise<Product> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT OR IGNORE INTO products (
      oliveyoung_product_id, name, brand, image_url, source_url, curator_url,
      normal_price, sale_price, discount_rate,
      last_checked_at, last_collect_status, last_collect_error,
      search_count, view_count, is_seed, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, 'SUCCESS', NULL, 0, 0, 1, ?, ?)`
    )
    .run(
      input.id,
      input.name,
      input.brand,
      input.imageUrl,
      input.sourceUrl,
      input.normalPrice,
      input.salePrice,
      input.discountRate,
      input.lastCheckedAt,
      now,
      now
    );
  return (await getProductById(input.id))!;
}

export async function updateProductMetadataAndPrice(
  id: string,
  fields: {
    name: string;
    brand: string;
    imageUrl: string | null;
    normalPrice: number;
    salePrice: number;
    discountRate: number;
    lastCheckedAt: string;
  }
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE products SET
      name = ?, brand = ?, image_url = ?,
      normal_price = ?, sale_price = ?, discount_rate = ?,
      last_checked_at = ?, last_collect_status = 'SUCCESS', last_collect_error = NULL,
      updated_at = ?
    WHERE oliveyoung_product_id = ?`
    )
    .run(
      fields.name,
      fields.brand,
      fields.imageUrl,
      fields.normalPrice,
      fields.salePrice,
      fields.discountRate,
      fields.lastCheckedAt,
      now,
      id
    );
}

/** Records a failed (or otherwise non-SUCCESS) collection. Existing price fields are left untouched (AGENTS.md §4). */
export async function recordCollectionFailure(
  id: string,
  status: Exclude<Product["lastCollectStatus"], "SUCCESS" | null>,
  error: string,
  checkedAt: string
): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE products SET
      last_checked_at = ?, last_collect_status = ?, last_collect_error = ?, updated_at = ?
    WHERE oliveyoung_product_id = ?`
    )
    .run(checkedAt, status, error, now, id);
}

export async function setCuratorUrl(id: string, curatorUrl: string | null): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db
    .prepare(`UPDATE products SET curator_url = ?, updated_at = ? WHERE oliveyoung_product_id = ?`)
    .run(curatorUrl, now, id);
}

export async function incrementViewCount(id: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE products SET view_count = view_count + 1 WHERE oliveyoung_product_id = ?`)
    .run(id);
}

/** Searches by name/brand (AGENTS.md §11 — search over products already in the DB, no external engine). */
export async function searchProducts(query: string): Promise<ProductWithPopularity[]> {
  const db = await getDb();
  const like = `%${query.trim()}%`;
  const rows = (await db
    .prepare(
      `SELECT p.*, COALESCE(t.cnt, 0) AS tracking_user_count
       FROM products p
       LEFT JOIN (
         SELECT product_id, COUNT(*) AS cnt FROM user_tracking GROUP BY product_id
       ) t ON t.product_id = p.oliveyoung_product_id
       WHERE p.name LIKE ? OR p.brand LIKE ?
       ORDER BY tracking_user_count DESC, p.updated_at DESC`
    )
    .all(like, like)) as unknown as (ProductRow & { tracking_user_count: number })[];

  if (rows.length > 0) {
    const bump = db.prepare(`UPDATE products SET search_count = search_count + 1 WHERE oliveyoung_product_id = ?`);
    for (const row of rows) {
      await bump.run(row.oliveyoung_product_id);
    }
  }

  return rows.map((row) => ({ ...toProduct(row), trackingUserCount: row.tracking_user_count }));
}

/** Popularity ranking (AGENTS.md §12): sorted by tracking user count, the primary MVP signal. */
export async function listPopularProducts(limit = 10): Promise<ProductWithPopularity[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT p.*, COALESCE(t.cnt, 0) AS tracking_user_count
       FROM products p
       LEFT JOIN (
         SELECT product_id, COUNT(*) AS cnt FROM user_tracking GROUP BY product_id
       ) t ON t.product_id = p.oliveyoung_product_id
       ORDER BY tracking_user_count DESC, p.created_at DESC
       LIMIT ?`
    )
    .all(limit)) as unknown as (ProductRow & { tracking_user_count: number })[];
  return rows.map((row) => ({ ...toProduct(row), trackingUserCount: row.tracking_user_count }));
}

export async function countTrackers(productId: string): Promise<number> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT COUNT(*) AS cnt FROM user_tracking WHERE product_id = ?`)
    .get(productId)) as { cnt: number };
  return row.cnt;
}

/** Products with at least one tracker — the full tracked set, ignoring per-product due timing. */
export async function listTrackedProducts(): Promise<Product[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT DISTINCT p.* FROM products p
       INNER JOIN user_tracking t ON t.product_id = p.oliveyoung_product_id`
    )
    .all()) as unknown as ProductRow[];
  return rows.map(toProduct);
}

/**
 * Tracked products whose `next_check_at` has passed (or was never set — e.g.
 * a product registered before this feature existed, or one whose only
 * attempt so far failed before scheduling metadata could be written).
 * This is what the scheduler actually processes each tick — see
 * lib/domain/collectionSchedule.ts for how `next_check_at` gets computed.
 *
 * Ordered most-overdue-first (NULLs — never checked — sort first in SQLite's
 * default ASC ordering, then oldest `next_check_at`) and optionally capped:
 * if a tick would otherwise take longer than the tick interval itself, the
 * scheduler skips its *next* run entirely rather than overlap (see
 * lib/priceScheduler.ts), so an unbounded query could make a backlog get
 * worse every tick instead of steadily working through it. Capping and
 * prioritizing the longest-waiting products keeps each tick's runtime
 * bounded and ensures nothing starves — see MAX_PRODUCTS_PER_TICK.
 */
export async function listDueTrackedProducts(nowIso: string, limit?: number): Promise<Product[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT * FROM (
         SELECT DISTINCT p.* FROM products p
         INNER JOIN user_tracking t ON t.product_id = p.oliveyoung_product_id
         WHERE p.next_check_at IS NULL OR p.next_check_at <= ?
       )
       ORDER BY next_check_at ASC
       LIMIT ?`
    )
    .all(nowIso, limit ?? -1)) as unknown as ProductRow[]; // SQLite: LIMIT -1 means "no limit"
  return rows.map(toProduct);
}

/**
 * Puts a product at the front of the collector's queue (next_check_at NULL
 * sorts first in listDueTrackedProducts). Used where the site can't collect
 * itself (lib/collectMode.ts): registration and the admin "가격 다시 확인"
 * button just ask the worker to pick it up on its next pass.
 */
export async function markDueNow(id: string): Promise<void> {
  const db = await getDb();
  await db.prepare(`UPDATE products SET next_check_at = NULL WHERE oliveyoung_product_id = ?`).run(id);
}

/**
 * Tracked products that have never been collected successfully. The worker
 * makes these due again when it starts, so products that failed on Vercel
 * (and are now sitting in failure backoff) get filled in right away.
 */
export async function listUncollectedTrackedProductIds(): Promise<string[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(
      `SELECT DISTINCT p.oliveyoung_product_id AS id FROM products p
       INNER JOIN user_tracking t ON t.product_id = p.oliveyoung_product_id
       WHERE p.sale_price IS NULL`
    )
    .all()) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export async function updateSchedulingMeta(
  id: string,
  fields: { nextCheckAt: string; consecutiveFailures: number; consecutiveSameCount: number }
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE products SET next_check_at = ?, consecutive_failures = ?, consecutive_same_count = ?
     WHERE oliveyoung_product_id = ?`
    )
    .run(fields.nextCheckAt, fields.consecutiveFailures, fields.consecutiveSameCount, id);
}
