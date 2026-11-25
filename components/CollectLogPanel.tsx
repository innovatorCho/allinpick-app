"use client";

import { useState, useTransition } from "react";
import { loadCollectLogsAction } from "@/lib/actions/admin-actions";
import { collectStatusLabel } from "@/lib/collectStatusLabels";
import { formatDateTime } from "@/lib/format";
import type { CollectLogEntry } from "@/lib/domain/types";

/**
 * Admin product page: the latest outcome at a glance (last result, last
 * success, failure streak, recent attempts as dots), with the full log
 * folded away behind a button and loaded page by page on "더 보기".
 */
export function CollectLogPanel({
  productId,
  initialLogs,
  total,
  lastSuccessAt,
  consecutiveFailures,
  pageSize,
}: {
  productId: string;
  /** Newest first, the first page. */
  initialLogs: CollectLogEntry[];
  total: number;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
  pageSize: number;
}) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState(initialLogs);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const latest = initialLogs[0];

  if (!latest) return <p className="text-sm text-zinc-500">수집 시도 기록이 없습니다.</p>;

  const ok = latest.status === "SUCCESS";
  // Oldest on the left, so the row reads like a timeline ending in "now".
  const recent = [...initialLogs].reverse();

  function loadMore() {
    setError(false);
    startLoading(async () => {
      try {
        const more = await loadCollectLogsAction(productId, logs.length);
        setLogs((prev) => [...prev, ...more.filter((m) => !prev.some((p) => p.id === m.id))]);
      } catch {
        setError(true);
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className={`flex flex-col gap-2 rounded-lg border p-3 text-sm ${
          ok
            ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950"
            : "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={`font-semibold ${ok ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300"}`}>
            {ok ? "✓ 최근 수집 성공" : `✕ 최근 수집 실패 · ${collectStatusLabel(latest.status)}`}
          </p>
          <span className="text-xs text-zinc-500">{formatDateTime(latest.createdAt)}</span>
        </div>
        {!ok && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {consecutiveFailures > 0 && <>연속 {consecutiveFailures}회 실패 · </>}
            마지막 성공 {lastSuccessAt ? formatDateTime(lastSuccessAt) : "없음"}
          </p>
        )}
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-xs text-zinc-500">최근 {recent.length}회</span>
          <div className="flex flex-wrap gap-1" aria-label={`최근 ${recent.length}회 중 성공 ${recent.filter((l) => l.status === "SUCCESS").length}회`}>
            {recent.map((l) => (
              <span
                key={l.id}
                title={`${formatDateTime(l.createdAt)} · ${collectStatusLabel(l.status)}`}
                className={`h-2.5 w-2.5 rounded-full ${l.status === "SUCCESS" ? "bg-emerald-500" : "bg-amber-500"}`}
              />
            ))}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="self-start text-xs font-medium text-zinc-600 underline hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {open ? "로그 접기" : `로그 보기 (총 ${total.toLocaleString("ko-KR")}건)`}
      </button>

      {open && (
        <div className="flex flex-col gap-2">
          <ul className="flex flex-col gap-1 text-sm">
            {logs.map((log) => (
              <li
                key={log.id}
                className="flex flex-col gap-0.5 border-b border-zinc-100 py-1 sm:flex-row sm:justify-between sm:gap-3 dark:border-zinc-900"
              >
                <span className="shrink-0 text-xs text-zinc-500">{formatDateTime(log.createdAt)}</span>
                <span
                  className={`break-words sm:text-right ${
                    log.status === "SUCCESS" ? "text-emerald-600" : "text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {collectStatusLabel(log.status)}
                  {log.errorMessage ? ` — ${log.errorMessage.split("\n")[0]}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {error && <p className="text-xs text-red-600">로그를 더 불러오지 못했어요. 다시 눌러주세요.</p>}
          {logs.length < total && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loading}
              className="self-center rounded-lg border border-zinc-300 px-4 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
            >
              {loading ? "불러오는 중..." : `더 보기 (${logs.length.toLocaleString("ko-KR")}/${total.toLocaleString("ko-KR")})`}
            </button>
          )}
          {logs.length >= total && total > pageSize && <p className="text-center text-xs text-zinc-400">모든 로그를 불러왔어요.</p>}
        </div>
      )}
    </div>
  );
}
