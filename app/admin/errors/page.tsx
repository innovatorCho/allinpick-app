import Link from "next/link";
import { getCurrentUser } from "@/lib/session";
import { listErrorLogs, countErrorLogs, type ErrorLogFilter, type AdminErrorLog } from "@/lib/domain/errorLogs";
import { formatDateTime } from "@/lib/format";
import {
  resolveErrorLogAction,
  reopenErrorLogAction,
  cleanupResolvedErrorLogsAction,
} from "@/lib/actions/admin-actions";
import { SubmitButton } from "@/components/SubmitButton";

const SOURCE_LABELS: Record<string, string> = {
  "request:render": "페이지 표시",
  "request:action": "사용자 동작",
  "request:route": "API 요청",
  "request:proxy": "프록시",
  "action:registerProduct": "상품 등록",
  "auth:start": "로그인 시작",
  "auth:token-exchange": "로그인 인증",
  "auth:create-session": "로그인 처리",
  "scheduler:cycle": "자동 재수집",
  "scheduler:db": "자동 재수집 DB",
  "scheduler:product": "상품 재수집",
  "scheduler:manual-run": "수동 재수집",
  "digest:check": "다이제스트",
  "digest:db": "다이제스트 DB",
  "digest:user": "다이제스트 발송",
};

const FILTERS: { value: ErrorLogFilter; label: string }[] = [
  { value: "open", label: "미처리" },
  { value: "resolved", label: "처리됨" },
  { value: "all", label: "전체" },
];

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

function prettyContext(raw: string | null): string | null {
  if (!raw) return null;
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

export default async function AdminErrorsPage({ searchParams }: PageProps<"/admin/errors">) {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  const { status, digest } = await searchParams;
  const filter: ErrorLogFilter = status === "resolved" || status === "all" ? status : "open";
  const digestQuery = typeof digest === "string" && digest.trim() ? digest.trim() : null;

  const [logs, counts] = await Promise.all([
    listErrorLogs(digestQuery ? "all" : filter, { digest: digestQuery }),
    countErrorLogs(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/admin" className="text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            ← 상품 관리
          </Link>
          <h1 className="mt-1 text-lg font-semibold">오류 로그</h1>
          <p className="mt-1 text-sm text-zinc-500">
            사용자에게는 안내 문구만 보이고, 실제 오류 내용은 여기에 기록됩니다. 원인을 고친 뒤 처리 완료로 표시하세요.
          </p>
        </div>
        <form action={cleanupResolvedErrorLogsAction}>
          <SubmitButton
            pendingText="정리 중..."
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            30일 지난 처리 완료 로그 삭제
          </SubmitButton>
        </form>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-sm dark:bg-zinc-900">
          {FILTERS.map((f) => {
            const count = f.value === "open" ? counts.open : f.value === "resolved" ? counts.resolved : counts.open + counts.resolved;
            const active = !digestQuery && filter === f.value;
            return (
              <Link
                key={f.value}
                href={`/admin/errors?status=${f.value}`}
                className={
                  active
                    ? "rounded-md bg-white px-3 py-1 font-medium shadow-sm dark:bg-zinc-800"
                    : "rounded-md px-3 py-1 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }
              >
                {f.label} <span className={f.value === "open" && count > 0 ? "text-red-600" : "text-zinc-400"}>{count}</span>
              </Link>
            );
          })}
        </nav>
        <form action="/admin/errors" method="GET" className="flex gap-2">
          <input
            type="text"
            name="digest"
            defaultValue={digestQuery ?? ""}
            placeholder="사용자가 알려준 오류 코드"
            className="w-56 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            찾기
          </button>
        </form>
      </div>

      {digestQuery && (
        <p className="text-sm text-zinc-500">
          오류 코드 <span className="font-mono">{digestQuery}</span> 검색 결과 {logs.length}건 ·{" "}
          <Link href="/admin/errors" className="underline">
            검색 해제
          </Link>
        </p>
      )}

      {logs.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-800">
          {digestQuery ? "일치하는 오류가 없습니다." : filter === "open" ? "처리할 오류가 없습니다." : "기록된 오류가 없습니다."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {logs.map((log) => (
            <ErrorLogItem key={log.id} log={log} />
          ))}
        </ul>
      )}
      {logs.length === 100 && <p className="text-xs text-zinc-400">최근 100건까지만 표시합니다.</p>}
    </div>
  );
}

function ErrorLogItem({ log }: { log: AdminErrorLog }) {
  const isOpen = log.resolvedAt == null;
  const context = prettyContext(log.context);

  return (
    <li
      className={`flex flex-col gap-2 rounded-lg border p-4 text-sm ${
        isOpen
          ? "border-red-200 bg-white dark:border-red-900/60 dark:bg-zinc-950"
          : "border-zinc-200 bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500">
        <span>{formatDateTime(log.createdAt)}</span>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {sourceLabel(log.source)}
        </span>
        {log.path && <span className="font-mono">{log.path}</span>}
        {isOpen && log.sameMessageOpenCount > 1 && (
          <span className="rounded-full bg-red-50 px-2 py-0.5 font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
            같은 오류 미처리 {log.sameMessageOpenCount}건
          </span>
        )}
      </div>

      <p className={`break-words font-mono text-[13px] ${isOpen ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
        {log.message}
      </p>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {log.userId && (
          <span>
            사용자: {log.userName ?? log.userId}
            {log.userEmail ? ` (${log.userEmail})` : ""}
          </span>
        )}
        {log.digest && (
          <span>
            오류 코드: <span className="font-mono">{log.digest}</span>
          </span>
        )}
      </div>

      {(log.stack || context) && (
        <details className="text-xs">
          <summary className="cursor-pointer select-none text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            상세 정보
          </summary>
          {context && (
            <pre className="mt-2 overflow-x-auto rounded bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">{context}</pre>
          )}
          {log.stack && (
            <pre className="mt-2 max-h-80 overflow-auto rounded bg-zinc-100 p-2 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
              {log.stack}
            </pre>
          )}
        </details>
      )}

      {isOpen ? (
        <form action={resolveErrorLogAction} className="flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <input type="hidden" name="id" value={log.id} />
          <input
            type="text"
            name="note"
            maxLength={500}
            placeholder="조치 내용 메모 (선택)"
            className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
          {log.sameMessageOpenCount > 1 && (
            <label className="flex items-center gap-1 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="includeSameMessage" defaultChecked />
              같은 오류 {log.sameMessageOpenCount}건 함께 처리
            </label>
          )}
          <SubmitButton
            pendingText="처리 중..."
            className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            처리 완료
          </SubmitButton>
        </form>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
          <span>
            처리 완료 · {formatDateTime(log.resolvedAt)}
            {log.resolvedByName ? ` · ${log.resolvedByName}` : ""}
            {log.resolutionNote ? ` · ${log.resolutionNote}` : ""}
          </span>
          <form action={reopenErrorLogAction}>
            <input type="hidden" name="id" value={log.id} />
            <SubmitButton pendingText="되돌리는 중..." className="underline hover:text-zinc-900 dark:hover:text-zinc-100">
              미처리로 되돌리기
            </SubmitButton>
          </form>
        </div>
      )}
    </li>
  );
}
