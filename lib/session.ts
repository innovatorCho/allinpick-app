import { cache } from "react";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { getUser } from "@/lib/domain/users";
import type { SessionRow } from "@/lib/db/rows";
import type { AppUser } from "@/lib/domain/types";
import { isSessionExpired, nextIdleDeadline, sessionPolicyFor } from "@/lib/sessionPolicy";

/**
 * Real, DB-backed sessions (replaces the old cookie-holds-a-fixed-test-user-id
 * approach — see chat history). The cookie only ever holds an opaque,
 * cryptographically random session id; nothing about the user is trusted
 * from the client, every read goes through the `sessions` table.
 */

const SESSION_COOKIE = "allinpick_session";
function toTimes(row: SessionRow) {
  return {
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    lastSeenAt: row.last_seen_at,
    idleTimeoutMs: row.idle_timeout_ms == null ? null : Number(row.idle_timeout_ms),
  };
}

/**
 * Resolves the logged-in user and enforces the session policy
 * (lib/sessionPolicy.ts): an expired session is deleted on sight, and an
 * active one has its idle deadline pushed forward (at most every few
 * minutes). Cached per request because the layout and the page both call it.
 *
 * An expired session's cookie can't be cleared from here (Server Components
 * can't set cookies); it's harmless, since its row is gone, and it's
 * replaced at the next login.
 */
export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const row = (await db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(token)) as SessionRow | undefined;
  if (!row) return null;

  const now = new Date();
  const times = toTimes(row);
  if (isSessionExpired(times, now)) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
    return null;
  }

  const deadline = nextIdleDeadline(times, now);
  if (deadline) {
    await db
      .prepare(`UPDATE sessions SET expires_at = ?, last_seen_at = ? WHERE id = ?`)
      .run(deadline, now.toISOString(), token);
  }

  return getUser(row.user_id);
});

/** For Server Actions/Route Handlers that require a logged-in user; throws otherwise. */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("로그인이 필요합니다.");
  }
  return user;
}

export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.role !== "admin") {
    throw new Error("관리자만 접근할 수 있습니다.");
  }
  return user;
}

/**
 * Creates a session row and sets the cookie. Only callable from a Route
 * Handler or Server Action. `rememberMe` is the login page's "로그인 상태
 * 유지" checkbox; it's ignored for admins (see lib/sessionPolicy.ts).
 */
export async function createSessionForUser(user: Pick<AppUser, "id" | "role">, rememberMe: boolean): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const policy = sessionPolicyFor(user.role, rememberMe);
  const absoluteExpiresAt = new Date(now.getTime() + policy.absoluteTimeoutMs);
  const idleExpiresAt = new Date(Math.min(now.getTime() + policy.idleTimeoutMs, absoluteExpiresAt.getTime()));

  // Housekeeping: this user's dead sessions (expired, or from before the policy existed).
  await db
    .prepare(
      `DELETE FROM sessions WHERE user_id = ?
         AND (absolute_expires_at IS NULL OR absolute_expires_at <= ? OR expires_at <= ?)`
    )
    .run(user.id, now.toISOString(), now.toISOString());

  await db
    .prepare(
      `INSERT INTO sessions (id, user_id, expires_at, created_at, absolute_expires_at, idle_timeout_ms, last_seen_at, remember_me)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      token,
      user.id,
      idleExpiresAt.toISOString(),
      now.toISOString(),
      absoluteExpiresAt.toISOString(),
      policy.idleTimeoutMs,
      now.toISOString(),
      policy.persistentCookie ? 1 : 0
    );

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // No `expires` → a browser-session cookie, gone when the browser closes.
    ...(policy.persistentCookie ? { expires: absoluteExpiresAt } : {}),
  });
}

/** Logs out: deletes the session row (so the token can't be replayed) and clears the cookie. */
export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
  }
  store.delete(SESSION_COOKIE);
}
