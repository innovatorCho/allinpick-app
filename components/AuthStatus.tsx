import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth-actions";
import type { AppUser } from "@/lib/domain/types";

export function AuthStatus({ currentUser }: { currentUser: AppUser | null }) {
  if (!currentUser) {
    return (
      <Link
        href="/login"
        className="rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        로그인
      </Link>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{currentUser.name}님</span>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-full px-3 py-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
