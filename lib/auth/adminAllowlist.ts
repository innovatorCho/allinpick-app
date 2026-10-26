/**
 * Admin role is never self-served through signup — the only way in is this
 * allowlist, checked once at account-creation time (AGENTS.md-adjacent
 * decision from chat history). Add your own email here (comma-separated,
 * case-insensitive) before your first login to get admin access.
 */
export function isAdminEmail(email: string | null): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.toLowerCase());
}
