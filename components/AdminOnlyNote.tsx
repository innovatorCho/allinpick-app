/**
 * Operator-only details (raw collection errors such as a Cloudflare block)
 * shown on shopper pages. Callers render it only for admins; the dashed box
 * and label keep it visibly apart from the shopper-facing notice it sits
 * next to, so an admin can tell what regular users don't see.
 */
export function AdminOnlyNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-400 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
      <p className="mb-1 font-semibold text-zinc-700 dark:text-zinc-300">🔒 관리자에게만 보여요</p>
      {children}
    </div>
  );
}
