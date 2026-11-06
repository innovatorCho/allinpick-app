import { createClient, type Client, type InValue, type Transaction } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { SCHEMA_SQL } from "./schema";

/**
 * Server-only Turso (libSQL) connection.
 *
 * This must never be imported from a Client Component — `@libsql/client`
 * bundled into client code would leak the DB URL/token into the browser;
 * `requireEnv` throwing clearly if misconfigured is the closest equivalent
 * guard Turso gives us (node:sqlite's own import-time failure isn't
 * available here since this is now a regular npm package, not a Node
 * built-in — be careful not to import this file from client code).
 *
 * Switched from node:sqlite (a local file) to Turso as the first step of a
 * Vercel migration — Vercel's serverless functions have an ephemeral
 * filesystem, so a local SQLite file can't survive between invocations.
 * Turso is SQL-dialect-compatible with SQLite, so SCHEMA_SQL below is
 * unchanged; what changed is every call site now being async (a network
 * call, not a local file read) — see lib/domain/*.ts.
 *
 * If `DATABASE_PATH` is set, this connects to a *local* libsql-backed file
 * instead of remote Turso — same @libsql/client, same async wrapper below,
 * just `file:...` instead of `https://...`. This exists entirely for
 * scripts/verify/*.ts: those scripts each want their own disposable,
 * isolated DB (create fresh, delete after) the way they always have.
 * Without this, every verify script would connect to the SAME real Turso
 * database as the live app — `npm run verify` would both pollute real data
 * with test rows AND run every test file against shared, non-isolated
 * state. The real app (no DATABASE_PATH in .env.local) always uses Turso.
 */

export class DbConfigError extends Error {}

/**
 * Thrown by every query method below on a network/connection failure —
 * deliberately a distinct, catchable type (not a raw libsql error) so
 * callers that care (Server Actions, the scheduler) can recognize "the DB
 * was unreachable" specifically, separate from a real application error.
 * Never thrown by node:sqlite in the old local-file setup — this failure
 * mode is new with a networked DB, which is why it needs handling it didn't
 * need before (see lib/priceScheduler.ts and lib/actions/*.ts for where
 * this is caught).
 */
export class DbConnectionError extends Error {
  constructor(cause: unknown) {
    super(
      `데이터베이스에 연결할 수 없습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도해주세요. (${
        cause instanceof Error ? cause.message : String(cause)
      })`
    );
    this.name = "DbConnectionError";
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new DbConfigError(
      `${name} 환경변수가 설정되지 않았습니다. turso.tech에서 DB를 만들고 .env.local에 TURSO_DATABASE_URL / TURSO_AUTH_TOKEN을 설정해주세요.`
    );
  }
  return value;
}

type SqlRow = Record<string, unknown>;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface PreparedStatement {
  get(...args: InValue[]): Promise<SqlRow | undefined>;
  all(...args: InValue[]): Promise<SqlRow[]>;
  run(...args: InValue[]): Promise<RunResult>;
}

export interface DbHandle {
  prepare(sql: string): PreparedStatement;
  /** Raw non-parameterized statement — PRAGMAs, DDL. */
  exec(sql: string): Promise<void>;
}

/** Wraps a libsql Client or Transaction — both expose the same `.execute()` shape we need. */
function wrap(executor: { execute(stmt: { sql: string; args: InValue[] }): Promise<{ rows: SqlRow[]; rowsAffected: number; lastInsertRowid?: bigint }> }): DbHandle {
  return {
    prepare(sql: string): PreparedStatement {
      return {
        async get(...args) {
          try {
            const result = await executor.execute({ sql, args });
            return result.rows[0];
          } catch (err) {
            throw new DbConnectionError(err);
          }
        },
        async all(...args) {
          try {
            const result = await executor.execute({ sql, args });
            return result.rows;
          } catch (err) {
            throw new DbConnectionError(err);
          }
        },
        async run(...args) {
          try {
            const result = await executor.execute({ sql, args });
            return { changes: Number(result.rowsAffected), lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
          } catch (err) {
            throw new DbConnectionError(err);
          }
        },
      };
    },
    async exec(sql: string) {
      try {
        await executor.execute({ sql, args: [] });
      } catch (err) {
        throw new DbConnectionError(err);
      }
    },
  };
}

// Columns added after a table's initial schema (SQLite has no "ADD COLUMN IF
// NOT EXISTS" — confirmed against node:sqlite while adding the first of
// these, and libsql has the same limitation since it's the same SQL dialect).
// Each entry only runs against a pre-existing table that predates it.
const COLUMN_MIGRATIONS: { table: string; column: string; ddl: string }[] = [
  { table: "products", column: "next_check_at", ddl: "ALTER TABLE products ADD COLUMN next_check_at TEXT" },
  {
    table: "products",
    column: "consecutive_failures",
    ddl: "ALTER TABLE products ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0",
  },
  {
    table: "products",
    column: "consecutive_same_count",
    ddl: "ALTER TABLE products ADD COLUMN consecutive_same_count INTEGER NOT NULL DEFAULT 0",
  },
  { table: "users", column: "email", ddl: "ALTER TABLE users ADD COLUMN email TEXT" },
  { table: "oauth_accounts", column: "access_token", ddl: "ALTER TABLE oauth_accounts ADD COLUMN access_token TEXT" },
  { table: "oauth_accounts", column: "refresh_token", ddl: "ALTER TABLE oauth_accounts ADD COLUMN refresh_token TEXT" },
  {
    table: "oauth_accounts",
    column: "token_expires_at",
    ddl: "ALTER TABLE oauth_accounts ADD COLUMN token_expires_at TEXT",
  },
  // Session policy (lib/sessionPolicy.ts). expires_at becomes the sliding
  // idle deadline; rows without absolute_expires_at predate the policy and
  // are treated as expired.
  { table: "sessions", column: "absolute_expires_at", ddl: "ALTER TABLE sessions ADD COLUMN absolute_expires_at TEXT" },
  { table: "sessions", column: "idle_timeout_ms", ddl: "ALTER TABLE sessions ADD COLUMN idle_timeout_ms INTEGER" },
  { table: "sessions", column: "last_seen_at", ddl: "ALTER TABLE sessions ADD COLUMN last_seen_at TEXT" },
  {
    table: "sessions",
    column: "remember_me",
    ddl: "ALTER TABLE sessions ADD COLUMN remember_me INTEGER NOT NULL DEFAULT 0",
  },
];

async function runMigrations(client: Client): Promise<void> {
  const tables = new Set(COLUMN_MIGRATIONS.map((m) => m.table));
  const existingByTable = new Map<string, Set<string>>();
  for (const table of tables) {
    // Table name interpolated, not parameterized — PRAGMA doesn't accept bind
    // params for its target, and this list is a fixed internal constant, never user input.
    const result = await client.execute(`PRAGMA table_info(${table})`);
    existingByTable.set(table, new Set((result.rows as unknown as { name: string }[]).map((c) => c.name)));
  }

  for (const migration of COLUMN_MIGRATIONS) {
    if (!existingByTable.get(migration.table)?.has(migration.column)) {
      await client.execute(migration.ddl);
    }
  }
}

declare global {
  var __allinpickDbClient: Client | undefined;
  var __allinpickDbReady: Promise<void> | undefined;
}

function getClient(): Client {
  if (!globalThis.__allinpickDbClient) {
    const localPath = process.env.DATABASE_PATH;
    if (localPath) {
      const absolutePath = resolve(/* turbopackIgnore: true */ process.cwd(), localPath);
      mkdirSync(dirname(absolutePath), { recursive: true });
      globalThis.__allinpickDbClient = createClient({ url: `file:${absolutePath}` });
    } else {
      globalThis.__allinpickDbClient = createClient({
        url: requireEnv("TURSO_DATABASE_URL"),
        authToken: requireEnv("TURSO_AUTH_TOKEN"),
      });
    }
  }
  return globalThis.__allinpickDbClient;
}

/** Runs once per process (cached on globalThis, same hot-reload-safe pattern the old file-based version used). */
function ensureSchema(client: Client): Promise<void> {
  if (!globalThis.__allinpickDbReady) {
    globalThis.__allinpickDbReady = (async () => {
      try {
        await client.execute("PRAGMA foreign_keys = ON;");
        await client.executeMultiple(SCHEMA_SQL);
        await runMigrations(client);
      } catch (err) {
        // Don't cache a failed init — the next getDb() call should retry
        // rather than permanently remembering "schema setup is broken" from
        // what might have been a transient network blip.
        globalThis.__allinpickDbReady = undefined;
        throw new DbConnectionError(err);
      }
    })();
  }
  return globalThis.__allinpickDbReady;
}

/**
 * Every call site now needs `await` here (and on every subsequent
 * `.get()/.all()/.run()/.exec()` call) — this used to be synchronous when
 * the DB was a local file; it's a network call now. Throws DbConfigError if
 * the env vars are missing, or DbConnectionError if Turso is unreachable —
 * see lib/priceScheduler.ts and lib/actions/*.ts for where callers that
 * can't just let it propagate catch these specifically.
 */
export async function getDb(): Promise<DbHandle> {
  const client = getClient();
  await ensureSchema(client);
  return wrap(client);
}

/**
 * Runs `fn` inside a real libSQL transaction (proper BEGIN/COMMIT/ROLLBACK
 * over the wire, not separate .exec() calls — a Turso HTTP connection can't
 * guarantee those land on the same session otherwise). Used by
 * lib/domain/users.ts's createOAuthUser (insert user + insert linked
 * oauth_accounts row atomically) and lib/domain/products.ts's deleteProduct.
 */
export async function runInTransaction<T>(fn: (tx: DbHandle) => Promise<T>): Promise<T> {
  const client = getClient();
  await ensureSchema(client);

  let tx: Transaction;
  try {
    tx = await client.transaction("write");
  } catch (err) {
    throw new DbConnectionError(err);
  }

  try {
    const result = await fn(wrap(tx));
    await tx.commit();
    return result;
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // Best-effort — the connection may already be gone if the original
      // error was itself a connection failure; the original error below is
      // what actually matters to the caller either way.
    }
    throw err instanceof DbConnectionError ? err : new DbConnectionError(err);
  }
}
