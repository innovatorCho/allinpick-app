import { Suspense } from "react";
import { searchProducts, listAllProducts } from "@/lib/domain/products";
import { ProductCard } from "@/components/ProductCard";
import { RegisterProductForm } from "@/components/RegisterProductForm";
import { OliveYoungCrawlResults } from "@/components/OliveYoungCrawlResults";
import { getCurrentUser } from "@/lib/session";

const URL_LIKE = /^https?:\/\//i;

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const isUrl = URL_LIKE.test(query);
  // A pasted product URL never matches by name/brand — route it to registration instead of a dead-end "no results".
  const results = query && !isUrl ? await searchProducts(query) : [];
  // Search only ever looks inside this list (AGENTS.md §11 — no external engine).
  // Surfacing it directly is what actually answers "is search finding anything at all?".
  const allProducts = await listAllProducts();
  // Crawl diagnostics and raw error text are for operators, not shoppers.
  const isAdmin = (await getCurrentUser())?.role === "admin";

  return (
    <div className="flex flex-col gap-4">
      <form action="/search" method="GET" className="flex gap-2">
        <input
          type="text"
          name="q"
          defaultValue={query}
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

      {isUrl ? (
        <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            상품 링크를 입력하셨네요. 아래에서 바로 등록하고 가격 알림을 받아보세요.
          </p>
          <RegisterProductForm defaultUrl={query} />
        </div>
      ) : query === "" ? (
        allProducts.length === 0 ? (
          <p className="text-sm text-zinc-500">
            아직 등록된 상품이 없어요. 올리브영 상품 링크를 붙여넣어 첫 상품을 등록해보세요.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">전체 상품</p>
            {allProducts.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        )
      ) : results.length === 0 ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-500">&quot;{query}&quot; 상품을 올리브영에서 찾아볼게요.</p>
          <Suspense
            key={query}
            fallback={<p className="text-sm text-zinc-500">올리브영에서 검색 중...</p>}
          >
            <OliveYoungCrawlResults keyword={query} showDiagnostics={isAdmin} />
          </Suspense>
          {allProducts.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">이런 상품은 어떠세요?</p>
              {allProducts.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-zinc-500">검색 결과 {results.length}건</p>
          {results.map((p) => (
            <ProductCard key={p.id} product={p} trackingUserCount={p.trackingUserCount} />
          ))}
        </div>
      )}
    </div>
  );
}
