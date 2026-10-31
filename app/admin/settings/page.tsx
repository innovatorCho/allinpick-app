import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { getSettingsByPrefix } from "@/lib/domain/settings";
import { getSiteSettingsWithSources, SITE_SETTING_FIELDS, type SiteSettingKey } from "@/lib/domain/siteSettings";
import { SiteSettingsForm } from "@/components/SiteSettingsForm";

export default async function AdminSettingsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  const [{ values, sources, missingRequired }, saved] = await Promise.all([
    getSiteSettingsWithSources(),
    getSettingsByPrefix("site."),
  ]);
  const adminValues: Partial<Record<SiteSettingKey, string>> = {};
  for (const field of SITE_SETTING_FIELDS) {
    const v = saved.get(`site.${field.key}`);
    if (v) adminValues[field.key] = v;
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href="/admin" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          ← 상품 관리
        </Link>
        <h1 className="mt-1 text-lg font-semibold">사이트 정보</h1>
        <p className="mt-1 break-keep text-sm text-zinc-500">
          하단 문구와{" "}
          <Link href="/privacy" className="underline">
            개인정보 처리방침
          </Link>
          에 들어가는 정보예요. 저장하면 코드 수정이나 재배포 없이 바로 반영돼요.
        </p>
      </div>

      {missingRequired.length > 0 && (
        <p className="break-keep rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          필수 정보 {missingRequired.map((f) => f.label).join(", ")}이(가) 비어 있어요. 지금은 처리방침에
          &quot;준비 중&quot;으로 표시돼요.
        </p>
      )}

      <SiteSettingsForm fields={SITE_SETTING_FIELDS} adminValues={adminValues} effectiveValues={values} sources={sources} />
    </div>
  );
}
