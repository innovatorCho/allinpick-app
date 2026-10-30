import { loginErrorMessage } from "@/lib/auth/loginErrors";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  // Only fixed messages keyed by code; the query string's text is never printed.
  const errorMessage = loginErrorMessage(error);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-12">
      <div className="text-center">
        <h1 className="text-lg font-semibold">로그인</h1>
        <p className="mt-1 text-sm text-zinc-500">로그인하고 관심 상품의 가격 알림을 받아보세요.</p>
      </div>

      {errorMessage && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-3 text-center text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {errorMessage}
        </p>
      )}

      <div className="flex flex-col gap-3">
        {/* Plain <a>, not next/link, on purpose: these hit a Route Handler that
            302s off-site to the provider. next/link tries to prefetch the RSC
            payload for its target first, which here means fetching across
            origin through that redirect — that fetch fails (seen live: "Failed
            to fetch RSC payload ... Falling back to browser navigation"),
            and Link only recovers via its own fallback. A plain <a> just
            navigates directly with no such attempt. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/google"
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Google로 로그인
        </a>
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/api/auth/kakao"
          className="flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-4 py-2.5 text-sm font-medium text-black hover:opacity-90"
        >
          카카오로 로그인
        </a>
      </div>
    </div>
  );
}
