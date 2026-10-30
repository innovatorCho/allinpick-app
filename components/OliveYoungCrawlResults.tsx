import { crawlOliveYoungByKeyword } from "@/lib/domain/searchCrawl";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { ProductCard } from "./ProductCard";

const STATUS_MESSAGE: Record<string, string> = {
  NO_MATCHES: "올리브영에서도 일치하는 상품을 찾지 못했어요. 다른 검색어로 시도해보세요.",
  NETWORK_ERROR: "지금은 올리브영에서 상품을 불러올 수 없어요. 잠시 후 다시 시도해주세요.",
  PARSER_ERROR: "지금은 올리브영에서 상품을 불러올 수 없어요. 잠시 후 다시 시도해주세요.",
};

/**
 * Streamed in behind a <Suspense> boundary on the search page (AGENTS.md
 * request: "내부에 없으면 크롤링"). A live crawl can take a few seconds and
 * may simply fail (see collectors/oliveyoung — network access to
 * oliveyoung.co.kr is blocked from this dev sandbox), so this never blocks
 * the rest of the search page and always renders a clear outcome either way.
 *
 * Shows every step (search URL tried, goodsNo found, per-product collection
 * result) rather than just success/fail — per explicit user request to see
 * what the crawl actually did, not just whether it worked.
 */
export async function OliveYoungCrawlResults({
  keyword,
  showDiagnostics = false,
}: {
  keyword: string;
  /** Admin-only: raw error text and the crawl step-by-step breakdown. */
  showDiagnostics?: boolean;
}) {
  const outcome = await crawlOliveYoungByKeyword(keyword);

  return (
    <div className="flex flex-col gap-3">
      {outcome.status !== "SUCCESS" && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p>{STATUS_MESSAGE[outcome.status] ?? "지금은 올리브영에서 상품을 불러올 수 없어요. 잠시 후 다시 시도해주세요."}</p>
          {showDiagnostics && outcome.error && <p className="mt-1 text-xs">{outcome.error}</p>}
        </div>
      )}

      {outcome.status === "SUCCESS" && outcome.products.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">올리브영에서 찾은 상품이에요</p>
          {outcome.products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}

      {/* Raw crawl diagnostics — this is an MVP built to verify technical feasibility (AGENTS.md §0/§23),
          so showing exactly what the crawl did is more useful here than hiding it behind a clean summary. */}
      {showDiagnostics && (
      <details className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
        <summary className="cursor-pointer select-none font-medium text-zinc-700 dark:text-zinc-300">
          크롤링 상세 결과 보기
        </summary>
        <dl className="mt-2 flex flex-col gap-1">
          <div>
            <dt className="inline font-medium">검색어: </dt>
            <dd className="inline">{outcome.keyword}</dd>
          </div>
          {outcome.searchUrl && (
            <div>
              <dt className="inline font-medium">요청한 검색 URL: </dt>
              <dd className="inline break-all">
                <a href={outcome.searchUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {outcome.searchUrl}
                </a>
                <span className="ml-1 text-zinc-400">(직접 열어서 확인 가능)</span>
              </dd>
            </div>
          )}
          <div>
            <dt className="inline font-medium">발견한 상품 ID: </dt>
            <dd className="inline">
              {outcome.foundGoodsNos.length > 0 ? outcome.foundGoodsNos.join(", ") : "없음"}
            </dd>
          </div>
          {outcome.attempts.length > 0 && (
            <div className="flex flex-col gap-0.5">
              <dt className="font-medium">상품별 상세 수집 결과:</dt>
              {outcome.attempts.map((a) => (
                <dd key={a.goodsNo}>
                  {a.goodsNo}: {collectStatusLabel(a.status)}
                  {a.error ? ` — ${a.error}` : ""}
                </dd>
              ))}
            </div>
          )}
        </dl>
      </details>
      )}
    </div>
  );
}
