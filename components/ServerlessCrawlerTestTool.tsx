"use client";

import { useActionState } from "react";
import {
  testServerlessCollectorAction,
  type ServerlessCrawlerTestFormState,
  type ServerlessCollectorRunStatus,
} from "@/lib/actions/admin-actions";

const initialState: ServerlessCrawlerTestFormState = {};

const STATUS_LABEL: Record<ServerlessCollectorRunStatus, string> = {
  success: "성공",
  challenge_blocked: "차단(Cloudflare)",
  error: "에러",
};

const STATUS_BADGE: Record<ServerlessCollectorRunStatus, string> = {
  success: "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  challenge_blocked: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300",
  error: "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300",
};

export function ServerlessCrawlerTestTool({ productId }: { productId: string }) {
  const [state, action, pending] = useActionState(testServerlessCollectorAction, initialState);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold">🧪 서버리스 크롤러 테스트 (실험적)</h3>
        <p className="mt-1 text-xs text-zinc-500">
          Vercel 이전 가능성을 검증하기 위한 도구입니다. 실제 상품 데이터는 절대 갱신하지 않고, 이 상품 페이지를
          서버리스용 Chromium(<code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">@sparticuz/chromium</code>)으로
          N번 수집해서 Cloudflare 통과 여부와 소요시간만 확인합니다. 로컬(macOS 등)에서는 이 바이너리 자체가 실행되지
          않을 수 있는데, 그 결과도 유의미합니다 — &quot;이 환경에서는 안 된다&quot;는 걸 보여주는 것이니까요.
        </p>
      </div>

      <form action={action} className="flex items-end gap-2">
        <input type="hidden" name="productId" value={productId} />
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">반복 횟수 (1~10)</span>
          <input
            type="number"
            name="runs"
            defaultValue={3}
            min={1}
            max={10}
            className="w-24 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "실행 중... (브라우저를 매번 새로 띄워서 느릴 수 있음)" : "테스트 실행"}
        </button>
      </form>

      {state.error && <p className="text-xs text-red-600">{state.error}</p>}

      {state.report && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            성공 {state.report.successCount}/{state.report.totalCount}회 · 평균 {state.report.averageElapsedMs}ms
          </p>
          <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2">#</th>
                  <th className="px-3 py-2">결과</th>
                  <th className="px-3 py-2">소요시간</th>
                  <th className="px-3 py-2">상세</th>
                </tr>
              </thead>
              <tbody>
                {state.report.runs.map((r) => (
                  <tr key={r.run} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="px-3 py-2 text-xs text-zinc-500">{r.run}</td>
                    <td className="px-3 py-2">
                      <span className={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{r.elapsedMs}ms</td>
                    <td className="px-3 py-2 text-xs text-zinc-500">{r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
