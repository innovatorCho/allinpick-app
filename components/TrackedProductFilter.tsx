"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export interface TrackedItem {
  id: string;
  name: string;
  brand: string;
  salePrice: number | null;
  discountRate: number | null;
  /** Current price is the lowest ever recorded (and the price has moved at least once). */
  atLowest: boolean;
  targetPrice: number | null;
  targetReached: boolean;
  awaitingInfo: boolean;
  /** Position in "most recently tracked first" order, for the default sort. */
  order: number;
  /** The server-rendered ProductCard plus its target-price line. */
  card: ReactNode;
}

type FilterKey = "all" | "lowest" | "target" | "discount" | "awaiting";
type SortKey = "recent" | "price" | "discount" | "name";

const FILTERS: { key: FilterKey; label: string; match: (i: TrackedItem) => boolean }[] = [
  { key: "all", label: "전체", match: () => true },
  { key: "lowest", label: "▼ 최저가", match: (i) => i.atLowest },
  { key: "target", label: "🎯 목표가 도달", match: (i) => i.targetReached },
  { key: "discount", label: "할인 중", match: (i) => (i.discountRate ?? 0) > 0 },
  { key: "awaiting", label: "정보 확인 중", match: (i) => i.awaitingInfo },
];

const SORTS: { key: SortKey; label: string }[] = [
  { key: "recent", label: "최근 추가순" },
  { key: "price", label: "낮은 가격순" },
  { key: "discount", label: "할인율 높은순" },
  { key: "name", label: "이름순" },
];

const PAGE_SIZE = 10;

/** Lowercase, no spaces — so "라로슈 포제" finds "라로슈포제" and vice versa. */
function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, "");
}

function compare(sort: SortKey) {
  return (a: TrackedItem, b: TrackedItem): number => {
    if (sort === "price") return (a.salePrice ?? Infinity) - (b.salePrice ?? Infinity) || a.order - b.order;
    if (sort === "discount") return (b.discountRate ?? 0) - (a.discountRate ?? 0) || a.order - b.order;
    if (sort === "name") return a.name.localeCompare(b.name, "ko");
    return a.order - b.order;
  };
}

function isFilterKey(v: string | null): v is FilterKey {
  return FILTERS.some((f) => f.key === v);
}
function isSortKey(v: string | null): v is SortKey {
  return SORTS.some((s) => s.key === v);
}

/**
 * Search box, filter chips, sort and pages for 내 관심상품. Filters in the
 * browser (a user tracks tens of products, not thousands) so results update
 * as you type, and mirrors the choice into the URL (?q=&filter=&sort=&page=)
 * so going back from a product page returns to the same view.
 */
export function TrackedProductFilter({
  items,
  initialQuery,
  initialFilter,
  initialSort,
  initialPage,
}: {
  items: TrackedItem[];
  initialQuery: string;
  initialFilter: string | null;
  initialSort: string | null;
  initialPage: string | null;
}) {
  const [query, setQueryState] = useState(initialQuery);
  const [filter, setFilterState] = useState<FilterKey>(isFilterKey(initialFilter) ? initialFilter : "all");
  const [sort, setSortState] = useState<SortKey>(isSortKey(initialSort) ? initialSort : "recent");
  const [page, setPage] = useState(() => Math.max(1, Number.parseInt(initialPage ?? "", 10) || 1));
  const listTop = useRef<HTMLDivElement>(null);

  // A new search, filter or sort starts again from page 1.
  const setQuery = (v: string) => {
    setQueryState(v);
    setPage(1);
  };
  const setFilter = (v: FilterKey) => {
    setFilterState(v);
    setPage(1);
  };
  const setSort = (v: SortKey) => {
    setSortState(v);
    setPage(1);
  };
  function goToPage(n: number) {
    setPage(n);
    listTop.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const set = (key: string, value: string, fallback: string) =>
      value && value !== fallback ? url.searchParams.set(key, value) : url.searchParams.delete(key);
    set("q", query.trim(), "");
    set("filter", filter, "all");
    set("sort", sort, "recent");
    set("page", String(page), "1");
    window.history.replaceState(window.history.state, "", url);
  }, [query, filter, sort, page]);

  const counts = useMemo(
    () => Object.fromEntries(FILTERS.map((f) => [f.key, items.filter(f.match).length])) as Record<FilterKey, number>,
    [items]
  );

  const visible = useMemo(() => {
    const terms = query.trim().split(/\s+/).filter(Boolean).map(normalize);
    const match = FILTERS.find((f) => f.key === filter)!.match;
    return items
      .filter((i) => match(i) && terms.every((t) => normalize(`${i.brand} ${i.name} ${i.id}`).includes(t)))
      .sort(compare(sort));
  }, [items, query, filter, sort]);

  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE));
  // A stale ?page= (fewer products since) shows the last page instead of nothing.
  const current = Math.min(page, pageCount);
  const pageItems = visible.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const narrowed = query.trim() !== "" || filter !== "all";
  const chipClass = (active: boolean) =>
    `shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium ${
      active
        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
        : "border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800"
    }`;

  return (
    <div ref={listTop} className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="상품명·브랜드 검색"
          aria-label="내 관심상품 검색"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="정렬"
          className="shrink-0 rounded-lg border border-zinc-300 bg-white px-2 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        >
          {SORTS.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {/* Chips scroll sideways on narrow phones instead of wrapping into rows. */}
      <div className="scrollbar-none -mx-4 flex gap-1.5 overflow-x-auto px-4" role="group" aria-label="필터">
        {FILTERS.filter((f) => f.key === "all" || counts[f.key] > 0 || f.key === filter).map((f) => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={chipClass(filter === f.key)}
          >
            {f.label} {counts[f.key]}
          </button>
        ))}
      </div>

      {narrowed && (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {items.length}개 중 {visible.length}개
        </p>
      )}

      {visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
          <p className="text-sm text-zinc-500">조건에 맞는 상품이 없어요.</p>
          <button
            type="button"
            onClick={() => {
              setQueryState("");
              setFilter("all");
            }}
            className="text-sm font-medium text-zinc-700 underline dark:text-zinc-300"
          >
            검색·필터 초기화
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {pageItems.map((i) => (
              <div key={i.id}>{i.card}</div>
            ))}
          </div>
          {pageCount > 1 && <Pagination current={current} count={pageCount} onChange={goToPage} />}
        </>
      )}
    </div>
  );
}

/** Page numbers around the current one (at most 5), plus previous/next. */
function Pagination({ current, count, onChange }: { current: number; count: number; onChange: (page: number) => void }) {
  const start = Math.max(1, Math.min(current - 2, count - 4));
  const pages = Array.from({ length: Math.min(5, count) }, (_, i) => start + i);
  const base = "flex h-9 min-w-9 items-center justify-center rounded-lg px-2 text-sm font-medium disabled:opacity-30";
  const idle = "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800";

  return (
    <nav aria-label="페이지" className="flex items-center justify-center gap-1 pt-2">
      <button type="button" onClick={() => onChange(current - 1)} disabled={current === 1} aria-label="이전 페이지" className={`${base} ${idle}`}>
        ‹ 이전
      </button>
      {pages.map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange(n)}
          aria-current={n === current ? "page" : undefined}
          className={`${base} ${
            n === current ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : idle
          }`}
        >
          {n}
        </button>
      ))}
      <button type="button" onClick={() => onChange(current + 1)} disabled={current === count} aria-label="다음 페이지" className={`${base} ${idle}`}>
        다음 ›
      </button>
    </nav>
  );
}
