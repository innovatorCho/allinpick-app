import type { Metadata } from "next";
import Link from "next/link";
import { getSiteSettings } from "@/lib/domain/siteSettings";
import { GuideText } from "@/components/GuideText";

export async function generateMetadata(): Promise<Metadata> {
  const { serviceName } = await getSiteSettings();
  return { title: `이용 가이드 - ${serviceName ?? "올인픽"}` };
}

/** The shopper manual; its text is edited at /admin/settings ("이용 가이드"). */
export default async function GuidePage() {
  const site = await getSiteSettings();

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <h1 className="text-lg font-semibold">이용 가이드</h1>
      {site.userGuide ? <GuideText text={site.userGuide} /> : <p className="text-sm text-zinc-500">준비 중이에요.</p>}
      <Link
        href="/"
        className="self-start rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        관심 상품 등록하러 가기
      </Link>
    </div>
  );
}
