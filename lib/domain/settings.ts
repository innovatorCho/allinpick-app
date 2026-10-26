import { getDb } from "@/lib/db/client";

/** Tiny key-value settings store — currently just the price scheduler's admin-configurable state. */

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDb();
  const row = (await db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key)) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value, new Date().toISOString());
}
