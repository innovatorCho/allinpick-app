import { getDb } from "@/lib/db/client";
import type { ErrorLogRow } from "@/lib/db/rows";

/**
 * Server-side error log for admins (/admin/errors).
 *
 * The rule this supports: shoppers never see raw error text. Every place
 * that catches an unexpected error shows a generic message to the user and
 * calls `recordError` so the real cause is still visible to an admin.
 * Uncaught errors reach here too, through instrumentation.ts's
 * `onRequestError`.
 *
 * Expected, high-volume outcomes stay in their own logs and are NOT written
 * here: per-product crawl results (collect_logs, product.last_collect_error)
 * and KakaoTalk sends (kakao_send_logs). This table is for things someone
 * should actually look at and fix.
 */

const MAX_MESSAGE_LENGTH = 2_000;
const MAX_STACK_LENGTH = 8_000;
const MAX_CONTEXT_LENGTH = 4_000;

export interface RecordErrorInput {
  /** Where it happened, e.g. "action:registerProduct", "auth:callback", "request:render". */
  source: string;
  error: unknown;
  path?: string | null;
  userId?: string | null;
  digest?: string | null;
  context?: Record<string, unknown>;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  return value.length > max ? `${value.slice(0, max)}…(생략)` : value;
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? `\nCaused by: ${error.cause.stack ?? error.cause.message}` : "";
    return { message: `${error.name}: ${error.message}`, stack: error.stack ? `${error.stack}${cause}` : null };
  }
  return { message: typeof error === "string" ? error : JSON.stringify(error) ?? String(error), stack: null };
}

/**
 * Best-effort: never throws. If the DB itself is what's failing, the error
 * still goes to the server console (Vercel Logs), and the caller carries on
 * showing its generic message.
 */
export async function recordError(input: RecordErrorInput): Promise<void> {
  const { message, stack } = describe(input.error);
  console.error(`[error-log] ${input.source}${input.path ? ` ${input.path}` : ""}:`, input.error);

  try {
    let context: string | null = null;
    if (input.context && Object.keys(input.context).length > 0) {
      try {
        context = JSON.stringify(input.context);
      } catch {
        context = String(input.context);
      }
    }

    const db = await getDb();
    await db
      .prepare(
        `INSERT INTO error_logs (source, message, stack, digest, path, user_id, context, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.source,
        truncate(message, MAX_MESSAGE_LENGTH) ?? "(메시지 없음)",
        truncate(stack, MAX_STACK_LENGTH),
        input.digest ?? null,
        truncate(input.path ?? null, 500),
        input.userId ?? null,
        truncate(context, MAX_CONTEXT_LENGTH),
        new Date().toISOString()
      );
  } catch (logErr) {
    console.error("[error-log] 오류 로그를 DB에 저장하지 못했습니다:", logErr);
  }
}

export type ErrorLogFilter = "open" | "resolved" | "all";

export interface AdminErrorLog {
  id: number;
  source: string;
  message: string;
  stack: string | null;
  digest: string | null;
  path: string | null;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
  context: string | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolutionNote: string | null;
  /** How many open rows share this exact message — shown so repeats are obvious. */
  sameMessageOpenCount: number;
}

export async function listErrorLogs(
  filter: ErrorLogFilter,
  options: { digest?: string | null; limit?: number } = {}
): Promise<AdminErrorLog[]> {
  const db = await getDb();
  const limit = options.limit ?? 100;
  const conditions: string[] = [];
  const args: (string | number)[] = [];
  if (filter === "open") conditions.push("e.resolved_at IS NULL");
  if (filter === "resolved") conditions.push("e.resolved_at IS NOT NULL");
  if (options.digest) {
    // The "오류 코드" a shopper sees on the error screen is this digest.
    conditions.push("e.digest = ?");
    args.push(options.digest);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = (await db
    .prepare(
      `SELECT e.*, u.name AS user_name, u.email AS user_email, r.name AS resolved_by_name,
              (SELECT COUNT(*) FROM error_logs s WHERE s.message = e.message AND s.resolved_at IS NULL) AS same_open
       FROM error_logs e
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users r ON r.id = e.resolved_by
       ${where}
       ORDER BY e.id DESC
       LIMIT ?`
    )
    .all(...args, limit)) as unknown as (ErrorLogRow & {
    user_name: string | null;
    user_email: string | null;
    resolved_by_name: string | null;
    same_open: number;
  })[];

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    message: row.message,
    stack: row.stack,
    digest: row.digest,
    path: row.path,
    userId: row.user_id,
    userName: row.user_name,
    userEmail: row.user_email,
    context: row.context,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    resolvedByName: row.resolved_by_name,
    resolutionNote: row.resolution_note,
    sameMessageOpenCount: Number(row.same_open),
  }));
}

export async function countErrorLogs(): Promise<{ open: number; resolved: number }> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS open,
              SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved
       FROM error_logs`
    )
    .get()) as { open: number | null; resolved: number | null } | undefined;
  return { open: Number(row?.open ?? 0), resolved: Number(row?.resolved ?? 0) };
}

export async function countOpenErrors(): Promise<number> {
  return (await countErrorLogs()).open;
}

/**
 * Marks one error resolved. With `includeSameMessage`, also resolves every
 * other open row with the identical message — the usual case once the
 * underlying cause is fixed, since one bug tends to log many times.
 * Returns how many rows were resolved.
 */
export async function resolveErrorLog(input: {
  id: number;
  adminUserId: string;
  note: string | null;
  includeSameMessage: boolean;
}): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  if (input.includeSameMessage) {
    const result = await db
      .prepare(
        `UPDATE error_logs SET resolved_at = ?, resolved_by = ?, resolution_note = ?
         WHERE resolved_at IS NULL AND message = (SELECT message FROM error_logs WHERE id = ?)`
      )
      .run(now, input.adminUserId, input.note, input.id);
    return result.changes;
  }
  const result = await db
    .prepare(
      `UPDATE error_logs SET resolved_at = ?, resolved_by = ?, resolution_note = ?
       WHERE id = ? AND resolved_at IS NULL`
    )
    .run(now, input.adminUserId, input.note, input.id);
  return result.changes;
}

export async function reopenErrorLog(id: number): Promise<void> {
  const db = await getDb();
  await db
    .prepare(`UPDATE error_logs SET resolved_at = NULL, resolved_by = NULL, resolution_note = NULL WHERE id = ?`)
    .run(id);
}

/** Housekeeping: drops resolved rows older than `days`. Open rows are never deleted. */
export async function deleteResolvedErrorLogsOlderThan(days: number): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const result = await db
    .prepare(`DELETE FROM error_logs WHERE resolved_at IS NOT NULL AND resolved_at < ?`)
    .run(cutoff);
  return result.changes;
}
