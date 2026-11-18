import Link from "next/link";
import { logoutAction } from "@/lib/actions/auth-actions";
import type { AppUser } from "@/lib/domain/types";

export function AuthStatus({ currentUser }: { currentUser: AppUser | null }) {
  if (!currentUser) {
    return (
      <Link
        href="/login"
        className="shrink-0 whitespace-nowrap rounded-full bg-zinc-900 px-3 py-1 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
      >
        로그인
      </Link>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1 whitespace-nowrap text-sm sm:gap-2">
      <span className="hidden text-zinc-600 sm:inline dark:text-zinc-400">{currentUser.name}님</span>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-full px-2 py-1 text-zinc-500 sm:px-3 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          로그아웃
        </button>
      </form>
    </div>
  );
}
