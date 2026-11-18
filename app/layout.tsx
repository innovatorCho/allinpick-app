import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/session";
import { AuthStatus } from "@/components/AuthStatus";
import { BrandMarkSvg } from "@/components/BrandMark";
import { countUnread } from "@/lib/domain/notifications";
import { countOpenErrors } from "@/lib/domain/errorLogs";
import { getSiteSettings } from "@/lib/domain/siteSettings";
import { KakaoChannelButton } from "@/components/KakaoChannelButton";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "올인픽 - 올리브영 최저가 알림",
  description: "올리브영 관심 상품을 등록하면 가격이 내려갈 때 알려드려요.",
};

// Tints the phone browser's address bar / status bar to match the header.
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const currentUser = await getCurrentUser();
  const unreadCount = currentUser ? await countUnread(currentUser.id) : 0;
  const openErrorCount = currentUser?.role === "admin" ? await countOpenErrors() : 0;
  const site = await getSiteSettings();

  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zinc-50 dark:bg-black">
        <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-4xl items-center justify-between gap-2 px-4 py-3">
            {/* One row on every phone: tighter gaps below sm, and the links
                scroll sideways instead of pushing 로그인 onto a second line. */}
            <nav className="scrollbar-none flex min-w-0 items-center gap-3 overflow-x-auto whitespace-nowrap text-sm font-medium sm:gap-4">
              <Link href="/" aria-label="올인픽 홈" className="flex shrink-0 items-center gap-1.5 font-semibold text-zinc-900 dark:text-zinc-50">
                <span className="h-6 w-6 shrink-0 overflow-hidden rounded-md">
                  <BrandMarkSvg />
                </span>
                {/* Logo only on the narrowest phones (iPhone SE size), so every link fits. */}
                <span className="hidden min-[360px]:inline">올인픽</span>
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
              <Link href="/guide" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                가이드
              </Link>
              {currentUser?.role === "admin" && (
                <Link href="/admin" className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                  관리자
                  {openErrorCount > 0 && (
                    <span
                      title={`미처리 오류 ${openErrorCount}건`}
                      className="ml-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
                    >
                      {openErrorCount > 99 ? "99+" : openErrorCount}
                    </span>
                  )}
                </Link>
              )}
            </nav>
            <AuthStatus currentUser={currentUser} />
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-6">{children}</main>
        <footer className="border-t border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
          <div className="mx-auto flex max-w-4xl flex-col gap-2 break-keep px-4 py-6 text-xs leading-relaxed text-zinc-500">
            <KakaoChannelButton url={site.kakaoChannelUrl} label={site.kakaoChannelButtonLabel} size="sm" />
            {site.priceDisclaimer && <p className="whitespace-pre-line">{site.priceDisclaimer}</p>}
            {site.footerNotice && <p className="whitespace-pre-line">{site.footerNotice}</p>}
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/privacy" className="font-semibold text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                개인정보 처리방침
              </Link>
              <Link href="/guide" className="hover:text-zinc-900 dark:hover:text-zinc-100">
                이용 가이드
              </Link>
              {site.contactEmail && (
                <a href={`mailto:${site.contactEmail}`} className="hover:text-zinc-900 dark:hover:text-zinc-100">
                  문의: {site.contactEmail}
                </a>
              )}
            </div>
          </div>
        </footer>
      </body>
    </html>
  );
}
