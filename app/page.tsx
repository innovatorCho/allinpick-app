import Link from "next/link";
import { RegisterProductForm } from "@/components/RegisterProductForm";
import { ProductCard } from "@/components/ProductCard";
import { BrandMarkSvg } from "@/components/BrandMark";
import { listPopularProducts, getProductById } from "@/lib/domain/products";
import { listTrackingForUser } from "@/lib/domain/tracking";
import { getCurrentUser } from "@/lib/session";

export default async function HomePage() {
  const currentUser = await getCurrentUser();
  const popular = await listPopularProducts(5);
  const tracking = currentUser
    ? (await Promise.all((await listTrackingForUser(currentUser.id)).map((t) => getProductById(t.productId)))).filter(
        (p): p is NonNullable<typeof p> => p != null
      )
    : [];

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl">
            <BrandMarkSvg />
          </div>
          <div>
            <h1 className="text-lg font-semibold">올리브영, 제일 쌀 때 사세요</h1>
            <p className="text-sm text-zinc-500">관심 상품을 등록하면 가격이 내려갈 때 알려드려요</p>
          </div>
        </div>
        <RegisterProductForm />
        <form action="/search" method="GET" className="flex gap-2">
          <input
            type="text"
            name="q"
            placeholder="상품명, 브랜드로 검색"
            className="flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            검색
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">인기 상품</h2>
        {popular.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 등록된 상품이 없어요. 올리브영 상품 링크를 붙여넣어 첫 상품을 등록해보세요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {popular.map((p) => (
              <ProductCard key={p.id} product={p} trackingUserCount={p.trackingUserCount} />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">내가 추적 중인 상품</h2>
          <Link href="/my" className="text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            전체 보기
          </Link>
        </div>
        {!currentUser ? (
          <p className="text-sm text-zinc-500">
            <Link href="/login" className="underline">
              로그인
            </Link>
            하면 추적 중인 상품을 볼 수 있습니다.
          </p>
        ) : tracking.length === 0 ? (
          <p className="text-sm text-zinc-500">아직 지켜보는 상품이 없어요. 관심 상품을 등록해보세요.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {tracking.slice(0, 5).map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
