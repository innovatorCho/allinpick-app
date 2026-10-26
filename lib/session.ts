import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { getDb } from "@/lib/db/client";
import { getUser } from "@/lib/domain/users";
import type { SessionRow } from "@/lib/db/rows";
import type { AppUser } from "@/lib/domain/types";

/**
 * Real, DB-backed sessions (replaces the old cookie-holds-a-fixed-test-user-id
 * approach — see chat history). The cookie only ever holds an opaque,
 * cryptographically random session id; nothing about the user is trusted
 * from the client, every read goes through the `sessions` table.
 */

const SESSION_COOKIE = "allinpick_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function getCurrentUser(): Promise<AppUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = await getDb();
  const row = (await db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(token)) as SessionRow | undefined;
  if (!row) return null;

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await db.prepare(`DELETE FROM sessions WHERE id = ?`).run(token);
    return null;
  }

  return getUser(row.user_id);
}

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

/** Creates a session row and sets the cookie. Only callable from a Route Handler or Server Action. */
export async function createSessionForUser(userId: string): Promise<void> {
  const db = await getDb();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  await db
    .prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)`)
    .run(token, userId, expiresAt.toISOString(), now.toISOString());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    expires: expiresAt,
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
