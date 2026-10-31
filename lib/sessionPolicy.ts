import type { AppUser } from "@/lib/domain/types";

/**
 * How long a login lasts, following what most shopping sites do:
 *
 *  - Normal login: the cookie lives only until the browser closes, the
 *    session ends after IDLE time without activity, and never lasts longer
 *    than ABSOLUTE even with constant use.
 *  - "로그인 상태 유지" (remember me), opted into on the login page: a
 *    persistent cookie and a much longer idle window, still with a hard cap
 *    so a stolen cookie can't live forever.
 *  - Admins: shorter limits and no remember-me, since an admin session can
 *    change site-wide settings.
 *
 * Kept in one pure module so the rules are easy to read and to test
 * (scripts/verify/test-session-policy.ts).
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface SessionPolicy {
  idleTimeoutMs: number;
  absoluteTimeoutMs: number;
  /** true: cookie survives a browser restart (until the absolute expiry). */
  persistentCookie: boolean;
}

export const SESSION_POLICIES = {
  user: { idleTimeoutMs: 2 * HOUR, absoluteTimeoutMs: 24 * HOUR, persistentCookie: false },
  userRemember: { idleTimeoutMs: 30 * DAY, absoluteTimeoutMs: 90 * DAY, persistentCookie: true },
  admin: { idleTimeoutMs: 1 * HOUR, absoluteTimeoutMs: 12 * HOUR, persistentCookie: false },
} as const satisfies Record<string, SessionPolicy>;

/**
 * Activity only extends a session if the last recorded activity is at least
 * this old. Saves a database write on every page view (each one is a network
 * call to Turso), at the cost of idle timing being accurate to ~5 minutes.
 */
export const SESSION_TOUCH_INTERVAL_MS = 5 * MINUTE;

export function sessionPolicyFor(role: AppUser["role"], rememberMe: boolean): SessionPolicy {
  if (role === "admin") return SESSION_POLICIES.admin;
  return rememberMe ? SESSION_POLICIES.userRemember : SESSION_POLICIES.user;
}

export interface SessionTimes {
  /** Idle deadline: when the session ends if there's no further activity. */
  expiresAt: string;
  absoluteExpiresAt: string | null;
  lastSeenAt: string | null;
  idleTimeoutMs: number | null;
}

/** Sessions from before this policy existed have no absolute expiry and are treated as expired (one forced re-login). */
export function isSessionExpired(session: SessionTimes, now: Date): boolean {
  if (!session.absoluteExpiresAt || session.idleTimeoutMs == null) return true;
  const t = now.getTime();
  return t >= new Date(session.absoluteExpiresAt).getTime() || t >= new Date(session.expiresAt).getTime();
}

/** New idle deadline if this activity should be recorded, or null to skip the write. */
export function nextIdleDeadline(session: SessionTimes, now: Date): string | null {
  if (!session.absoluteExpiresAt || session.idleTimeoutMs == null) return null;
  const t = now.getTime();
  if (session.lastSeenAt && t - new Date(session.lastSeenAt).getTime() < SESSION_TOUCH_INTERVAL_MS) return null;
  const deadline = Math.min(t + session.idleTimeoutMs, new Date(session.absoluteExpiresAt).getTime());
  return new Date(deadline).toISOString();
}
