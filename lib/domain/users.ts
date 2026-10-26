import { randomBytes } from "node:crypto";
import { getDb, runInTransaction } from "@/lib/db/client";
import type { OAuthAccountRow, UserRow } from "@/lib/db/rows";
import type { AppUser, OAuthProvider } from "./types";

function toAppUser(row: UserRow): AppUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role as AppUser["role"],
  };
}

/**
 * Fixed reference users kept for the dev-only sample-data generator
 * (lib/domain/seed.ts) — its price history/tracking/notification rows need
 * some `user_id` to belong to. They are NOT a login mechanism anymore (see
 * AGENTS.md-adjacent chat history: replaced by real Google/Kakao login) —
 * nothing can authenticate as one of these since they have no OAuth account
 * linked. Seeded once so seed.ts's foreign keys resolve.
 */
export const TEST_USERS: AppUser[] = [
  { id: "user-a", name: "사용자 A", email: null, role: "user" },
  { id: "user-b", name: "사용자 B", email: null, role: "user" },
  { id: "user-c", name: "사용자 C", email: null, role: "user" },
  { id: "admin", name: "관리자", email: null, role: "admin" },
];

let seeded = false;

export async function ensureUsersSeeded(): Promise<void> {
  if (seeded) return;
  const db = await getDb();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, NULL, ?, ?)`
  );
  const now = new Date().toISOString();
  for (const user of TEST_USERS) {
    await insert.run(user.id, user.name, user.role, now);
  }
  seeded = true;
}

export async function getUser(userId: string): Promise<AppUser | null> {
  const db = await getDb();
  const row = (await db.prepare(`SELECT * FROM users WHERE id = ?`).get(userId)) as UserRow | undefined;
  return row ? toAppUser(row) : null;
}

export async function findUserByOAuthAccount(provider: OAuthProvider, providerUserId: string): Promise<AppUser | null> {
  const db = await getDb();
  const row = (await db
    .prepare(
      `SELECT u.* FROM users u
       INNER JOIN oauth_accounts a ON a.user_id = u.id
       WHERE a.provider = ? AND a.provider_user_id = ?`
    )
    .get(provider, providerUserId)) as UserRow | undefined;
  return row ? toAppUser(row) : null;
}

function generateUserId(): string {
  return `usr_${randomBytes(12).toString("hex")}`;
}

export interface OAuthTokenInput {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
}

/**
 * Creates a new local user + linked OAuth account for a first-time sign-in.
 * Admin role is never self-served — it's granted only via the ADMIN_EMAILS
 * env allowlist, checked once at creation time (see lib/auth/session.ts).
 */
export async function createOAuthUser(input: {
  provider: OAuthProvider;
  providerUserId: string;
  email: string | null;
  name: string;
  isAdmin: boolean;
  tokens?: OAuthTokenInput;
}): Promise<AppUser> {
  const now = new Date().toISOString();
  const id = generateUserId();

  // Real BEGIN/COMMIT/ROLLBACK over the wire (see lib/db/client.ts's
  // runInTransaction doc comment for why this isn't just two separate .run() calls).
  await runInTransaction(async (tx) => {
    await tx
      .prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(id, input.name, input.email, input.isAdmin ? "admin" : "user", now);
    await tx
      .prepare(
        `INSERT INTO oauth_accounts (user_id, provider, provider_user_id, access_token, refresh_token, token_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.provider,
        input.providerUserId,
        input.tokens?.accessToken ?? null,
        input.tokens?.refreshToken ?? null,
        input.tokens?.expiresAt ?? null,
        now
      );
  });

  return (await getUser(id))!;
}

/** Refreshes the stored tokens on an *existing* oauth_accounts row — called on every login, not just the first. */
export async function updateOAuthTokens(
  provider: OAuthProvider,
  providerUserId: string,
  tokens: OAuthTokenInput
): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE oauth_accounts SET access_token = ?, refresh_token = ?, token_expires_at = ?
     WHERE provider = ? AND provider_user_id = ?`
    )
    .run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt, provider, providerUserId);
}

export async function listOAuthAccountsForUser(userId: string): Promise<OAuthAccountRow[]> {
  const db = await getDb();
  return (await db.prepare(`SELECT * FROM oauth_accounts WHERE user_id = ?`).all(userId)) as unknown as OAuthAccountRow[];
}

/** The stored Kakao account (with tokens) for a user, if they've linked one — used by lib/kakaoMessaging.ts. */
export async function getOAuthAccount(userId: string, provider: OAuthProvider): Promise<OAuthAccountRow | null> {
  const db = await getDb();
  const row = (await db
    .prepare(`SELECT * FROM oauth_accounts WHERE user_id = ? AND provider = ?`)
    .get(userId, provider)) as OAuthAccountRow | undefined;
  return row ?? null;
}

/** Every user row (real OAuth accounts + the seeded reference ones) — for the admin notification-test tool's user picker. */
export async function listAllUsers(): Promise<AppUser[]> {
  const db = await getDb();
  const rows = (await db.prepare(`SELECT * FROM users ORDER BY created_at DESC`).all()) as unknown as UserRow[];
  return rows.map(toAppUser);
}
