import { getDb } from "@/lib/db/client";
import type { PriceHistoryRow, CollectLogRow } from "@/lib/db/rows";
import type {
  CollectLogEntry,
  PriceChangeType,
  PriceHistoryEntry,
  PriceHistorySource,
} from "./types";

function toPriceHistory(row: PriceHistoryRow): PriceHistoryEntry {
  return {
    id: row.id,
    productId: row.product_id,
    price: row.price,
    changeType: row.change_type as PriceChangeType,
    recordedAt: row.recorded_at,
    source: row.source as PriceHistorySource,
  };
}

function toCollectLog(row: CollectLogRow): CollectLogEntry {
  return {
    id: row.id,
    productId: row.product_id,
    status: row.status as CollectLogEntry["status"],
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

/** Inserted only on an actual price change (or first data point) — AGENTS.md §7. */
export async function insertPriceHistory(input: {
  productId: string;
  price: number;
  changeType: PriceChangeType;
  recordedAt: string;
  source?: PriceHistorySource;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO price_history (product_id, price, change_type, recorded_at, source) VALUES (?, ?, ?, ?, ?)`
    )
    .run(input.productId, input.price, input.changeType, input.recordedAt, input.source ?? "collector");
}

export async function listPriceHistory(productId: string): Promise<PriceHistoryEntry[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM price_history WHERE product_id = ? ORDER BY recorded_at ASC`)
    .all(productId)) as unknown as PriceHistoryRow[];
  return rows.map(toPriceHistory);
}

export async function insertCollectLog(input: {
  productId: string;
  status: CollectLogEntry["status"];
  errorMessage: string | null;
  createdAt: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`INSERT INTO collect_logs (product_id, status, error_message, created_at) VALUES (?, ?, ?, ?)`)
    .run(input.productId, input.status, input.errorMessage, input.createdAt);
}

export async function listCollectLogs(productId: string, limit = 20): Promise<CollectLogEntry[]> {
  const db = await getDb();
  const rows = (await db
    .prepare(`SELECT * FROM collect_logs WHERE product_id = ? ORDER BY created_at DESC LIMIT ?`)
    .all(productId, limit)) as unknown as CollectLogRow[];
  return rows.map(toCollectLog);
}

/**
 * Lowest/highest price ever recorded for this product, over its whole
 * tracked history (not just a recent window) — used to show "최저가 대비" on
 * product cards. `price_history` gains a row on every actual price change
 * (and on the first collection), so this always reflects the true range,
 * including the current price.
 */
export async function getPriceRange(productId: string): Promise<{ min: number; max: number } | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT MIN(price) AS min, MAX(price) AS max FROM price_history WHERE product_id = ?`)
    .get(productId)) as { min: number | null; max: number | null };
  if (row.min == null || row.max == null) return null;
  return { min: row.min, max: row.max };
}
