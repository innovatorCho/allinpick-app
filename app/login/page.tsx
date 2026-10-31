import Link from "next/link";
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

      {/* A plain GET <form>, not next/link: these buttons hit a Route Handler
          that 302s off-site to the provider, and next/link's RSC prefetch fails
          across that redirect (seen live: "Failed to fetch RSC payload").
          A native form submit just navigates, and carries the checkbox along
          as ?remember=1 with no client JavaScript. */}
      <form method="GET" className="flex flex-col gap-3">
        <button
          type="submit"
          formAction="/api/auth/google"
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          Google로 로그인
        </button>
        <button
          type="submit"
          formAction="/api/auth/kakao"
          className="flex items-center justify-center gap-2 rounded-lg bg-[#FEE500] px-4 py-2.5 text-sm font-medium text-black hover:opacity-90"
        >
          카카오로 로그인
        </button>
        <label className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" name="remember" value="1" className="h-4 w-4" />
          로그인 상태 유지
        </label>
        <p className="-mt-2 break-keep text-xs text-zinc-400">
          개인 기기에서만 사용하세요. 체크하지 않으면 브라우저를 닫거나 2시간 동안 사용하지 않을 때 자동으로 로그아웃돼요.
        </p>
      </form>

      {/* Collection notice: 목적, 항목, 보유 기간, 거부 권리 (개인정보 보호법 제15조). */}
      <section className="flex flex-col gap-2 break-keep rounded-lg border border-zinc-200 bg-white p-4 text-xs leading-relaxed text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
        <h2 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">개인정보 수집 안내</h2>
        <dl className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
          <dt className="font-medium text-zinc-700 dark:text-zinc-300">수집 항목</dt>
          <dd>이름(닉네임), 이메일, 로그인 서비스 회원번호, 카카오톡 알림 발송 권한(카카오 로그인 시)</dd>
          <dt className="font-medium text-zinc-700 dark:text-zinc-300">이용 목적</dt>
          <dd>회원 식별, 관심 상품 관리, 가격 하락 알림 발송</dd>
          <dt className="font-medium text-zinc-700 dark:text-zinc-300">보유 기간</dt>
          <dd>회원 탈퇴 요청 시까지</dd>
        </dl>
        <p>
          수집에 동의하지 않으셔도 로그인 없이 상품 검색과 가격 확인은 이용할 수 있어요. 다만 관심 상품 등록과 가격
          알림은 이용할 수 없어요.
        </p>
        <p>
          로그인하면 위 내용과{" "}
          <Link href="/privacy" className="font-medium text-zinc-800 underline dark:text-zinc-200">
            개인정보 처리방침
          </Link>
          에 따라 개인정보가 처리돼요.
        </p>
      </section>
    </div>
  );
}
