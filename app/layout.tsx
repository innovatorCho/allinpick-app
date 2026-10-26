import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { AuthStatus } from "@/components/AuthStatus";
import { BrandMarkSvg } from "@/components/BrandMark";
import { countUnread } from "@/lib/domain/notifications";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "올인픽 - 올리브영 가격 추적",
  description: "올리브영 상품 가격을 추적하는 기능 검증용 MVP 테스트 앱",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const currentUser = await getCurrentUser();
  const unreadCount = currentUser ? await countUnread(currentUser.id) : 0;

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <nav className="flex items-center gap-4 text-sm font-medium">
              <Link href="/" className="flex items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-50">
                <span className="h-6 w-6 shrink-0 overflow-hidden rounded-md">
                  <BrandMarkSvg />
                </span>
                올인픽
              </Link>
              <Link href="/search" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                검색
              </Link>
              <Link
                href="/my"
                className="relative text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              >
                내 관심상품
                {unreadCount > 0 && (
                  <span className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                )}
              </Link>
              {currentUser?.role === "admin" && (
                <Link href="/admin" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                  관리자
                </Link>
              )}
            </nav>
            <AuthStatus currentUser={currentUser} />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
