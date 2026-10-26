/**
 * Schema for the price-tracker MVP.
 *
 * Design notes (see AGENTS.md §5):
 *  - `products` is the single shared record per real-world item, keyed by
 *    OliveYoung's own `goodsNo` (oliveyoung_product_id) rather than a
 *    synthetic id or the raw URL, so duplicate registrations always resolve
 *    to the same row (§6).
 *  - `price_history` only gains a row when the price actually changes (or on
 *    first registration). Every collection attempt — successful or not — is
 *    still recorded in `collect_logs`, which is what lets `last_checked_at`
 *    advance without inflating price history (§7).
 *  - `user_tracking` is the many-to-many link between users and products, so
 *    N users can track one product without duplicating product/price data.
 */
export const SCHEMA_SQL = `
PRAGMA foreign_keys = ON;

-- email is deliberately NOT unique: two different OAuth providers reporting
-- the same address must be allowed to create two separate users here (see
-- oauth_accounts below) — a unique constraint would crash a real, plausible
-- login (same person, Google once and Kakao another time) instead of just
-- creating a second account, which is caught by a test (scripts/verify/test-auth.ts).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
  created_at TEXT NOT NULL
);

-- One row per (provider, provider account) a user has signed in with. Kept
-- separate from the users table (rather than columns on it) so a user could link a
-- second provider later without a schema change. This MVP doesn't do
-- cross-provider account linking by email — deliberately, to avoid trusting
-- an unverified email match between two different identity providers — so
-- today each provider login always maps to exactly one oauth_accounts row.
-- access_token/refresh_token/token_expires_at: kept so a background job (a
-- price drop found by the scheduler, not a live request) can still send a
-- KakaoTalk "메시지 나에게 보내기" notification later — the token from login
-- alone doesn't survive past that request. Stored in plaintext: acceptable
-- for this MVP's single local SQLite file, but flagged here as something a
-- real deployment must encrypt at rest.
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'kakao')),
  provider_user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  token_expires_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (provider, provider_user_id)
);

-- Server-side session store backing the login cookie (see lib/auth/session.ts).
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS products (
  oliveyoung_product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  image_url TEXT,
  source_url TEXT NOT NULL,
  curator_url TEXT,
  normal_price INTEGER,
  sale_price INTEGER,
  discount_rate INTEGER,
  last_checked_at TEXT,
  last_collect_status TEXT,
  last_collect_error TEXT,
  search_count INTEGER NOT NULL DEFAULT 0,
  view_count INTEGER NOT NULL DEFAULT 0,
  is_seed INTEGER NOT NULL DEFAULT 0,
  next_check_at TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_same_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS price_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products (oliveyoung_product_id) ON DELETE CASCADE,
  price INTEGER NOT NULL,
  change_type TEXT NOT NULL CHECK (change_type IN ('initial', 'increase', 'decrease', 'same')),
  recorded_at TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('collector', 'seed')) DEFAULT 'collector'
);
CREATE INDEX IF NOT EXISTS idx_price_history_product ON price_history (product_id, recorded_at);

CREATE TABLE IF NOT EXISTS collect_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL REFERENCES products (oliveyoung_product_id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_collect_logs_product ON collect_logs (product_id, created_at);

CREATE TABLE IF NOT EXISTS user_tracking (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (oliveyoung_product_id) ON DELETE CASCADE,
  target_price INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_user_tracking_product ON user_tracking (product_id);
CREATE INDEX IF NOT EXISTS idx_user_tracking_user ON user_tracking (user_id);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (oliveyoung_product_id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('price_drop', 'target_price')),
  message TEXT NOT NULL,
  old_price INTEGER,
  new_price INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications (user_id, created_at);

-- Small key-value store for admin-configurable settings (currently: the price
-- scheduler's interval/enabled flag) so they survive a server restart instead
-- of only living in the env var default.
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per attempted KakaoTalk "나에게 보내기" send (lib/kakaoMessaging.ts).
-- That send is fire-and-forget and best-effort by design (see oauth_accounts'
-- doc comment), so without this table its outcome only ever showed up in the
-- server console — invisible during unattended/automatic operation. 'skipped'
-- covers the normal, non-error case of a user with no linked Kakao account.
CREATE TABLE IF NOT EXISTS kakao_send_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id TEXT NOT NULL REFERENCES products (oliveyoung_product_id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL CHECK (notification_type IN ('price_drop', 'target_price')),
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kakao_send_logs_created ON kakao_send_logs (created_at);

-- One row per (user, calendar day) — the "N개 상품 가격이 내려갔어요" daily
-- digest Kakao message (lib/digestScheduler.ts), separate from kakao_send_logs
-- because a digest isn't about one product (no single product_id to point
-- at), unlike every other Kakao send this app does. digest_date is a plain
-- 'YYYY-MM-DD' key (Asia/Seoul) rather than a timestamp range, specifically
-- so the UNIQUE constraint below can guarantee "at most once per user per
-- day" even if the hourly digest check runs more than once after the send
-- window opens — the upsert in lib/domain/kakaoDigestLogs.ts relies on it.
CREATE TABLE IF NOT EXISTS kakao_digest_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  digest_date TEXT NOT NULL,
  drop_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'skipped', 'failed')),
  detail TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, digest_date)
);
CREATE INDEX IF NOT EXISTS idx_kakao_digest_logs_date ON kakao_digest_logs (digest_date);
`;
