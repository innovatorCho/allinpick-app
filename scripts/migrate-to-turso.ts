/**
 * One-time data migration: copies every row from the old local SQLite file
 * (.data/app.db, read via node:sqlite) into the new Turso database (written
 * via @libsql/client directly, using TURSO_DATABASE_URL/TURSO_AUTH_TOKEN from
 * the environment — NOT DATABASE_PATH, which would point this at another
 * local file instead of the real remote DB).
 *
 * Uses batch inserts (not one-row-at-a-time through lib/db/client.ts's
 * wrapper) purely for speed — collect_logs alone had ~2000 rows, and one
 * network round-trip per row was too slow to finish in reasonable time.
 *
 * Run once, after the Turso migration (lib/db/client.ts) landed but before
 * switching the running app over to it, so real data (users, oauth tokens,
 * tracked products, price history, notifications...) survives the cutover:
 *
 *   node --experimental-strip-types --import ./scripts/verify/register.mjs scripts/migrate-to-turso.ts
 *
 * Safe to re-run: every insert is "INSERT OR IGNORE", so already-migrated
 * rows (same primary key) are skipped rather than duplicated or erroring.
 */
import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { createClient, type InValue } from "@libsql/client";
import { getDb } from "@/lib/db/client";

if (process.env.DATABASE_PATH) {
  throw new Error(
    "DATABASE_PATH가 설정되어 있습니다 — 이 스크립트는 실제 Turso DB로 써야 하니, 이 환경변수 없이 실행해주세요."
  );
}

const TURSO_DATABASE_URL = process.env.TURSO_DATABASE_URL;
const TURSO_AUTH_TOKEN = process.env.TURSO_AUTH_TOKEN;
if (!TURSO_DATABASE_URL || !TURSO_AUTH_TOKEN) {
  throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN이 설정되어 있어야 합니다.");
}

const OLD_DB_PATH = resolve(process.cwd(), process.env.OLD_DATABASE_PATH ?? ".data/app.db");
const BATCH_SIZE = 200;

// Dependency order — parents before children (matches lib/db/schema.ts's own
// CREATE TABLE order, which already respects every FK relationship here).
const TABLES = [
  "users",
  "oauth_accounts",
  "sessions",
  "products",
  "price_history",
  "collect_logs",
  "user_tracking",
  "notifications",
  "app_settings",
  "kakao_send_logs",
];

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function main() {
  console.log(`[migrate-to-turso] 원본(로컬): ${OLD_DB_PATH}`);
  const oldDb = new DatabaseSync(OLD_DB_PATH, { readOnly: true });

  console.log("[migrate-to-turso] Turso 스키마 준비 중 (lib/db/client.ts의 getDb()로 생성/확인)...");
  await getDb(); // ensures schema + column migrations exist on the Turso side before we insert into it

  const turso = createClient({ url: TURSO_DATABASE_URL!, authToken: TURSO_AUTH_TOKEN! });

  for (const table of TABLES) {
    const rows = oldDb.prepare(`SELECT * FROM ${table}`).all() as Record<string, InValue>[];
    if (rows.length === 0) {
      console.log(`[migrate-to-turso] ${table}: 0건 (건너뜀)`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`;

    let totalChanges = 0;
    for (const batch of chunk(rows, BATCH_SIZE)) {
      const results = await turso.batch(
        batch.map((row) => ({ sql, args: columns.map((c) => row[c]) })),
        "write"
      );
      totalChanges += results.reduce((sum, r) => sum + r.rowsAffected, 0);
    }
    console.log(`[migrate-to-turso] ${table}: ${rows.length}건 중 ${totalChanges}건 새로 삽입 (나머지는 이미 있었음)`);
  }

  oldDb.close();
  console.log("[migrate-to-turso] 완료");
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate-to-turso] 실패:", err);
  process.exit(1);
});
