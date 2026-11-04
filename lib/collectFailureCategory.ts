import type { CollectStatus } from "@/lib/domain/types";

/**
 * Collapses a failed collection into a short, human-readable cause for log
 * summaries. The stored status is coarse (most browser problems are all
 * "NETWORK_ERROR"), which is what made the 2026-11 Vercel failures hard to
 * tell apart; the error text says much more.
 */
export function collectFailureCategory(status: CollectStatus, error: string | undefined): string {
  if (status === "BOT_BLOCKED") return "봇 차단";
  if (status === "PARSER_ERROR") return "페이지 해석 실패";
  const msg = error ?? "";
  if (msg.includes("안에 끝나지 않아")) return "처리 시간 초과(55초)";
  if (msg.includes("ERR_INSUFFICIENT_RESOURCES")) return "브라우저 자원 부족";
  if (msg.includes("has been closed")) return "브라우저 종료됨";
  if (/ETXTBSY|ENOEXEC|browserType\.launch/.test(msg)) return "브라우저 실행 실패";
  if (/Timeout \d+ms exceeded/.test(msg)) return "페이지 응답 시간 초과";
  const http = msg.match(/HTTP (\d{3})/);
  if (http) return `HTTP ${http[1]}`;
  const net = msg.match(/net::(ERR_[A-Z_]+)/);
  if (net) return net[1];
  if (/데이터베이스|SQLITE|libsql/i.test(msg)) return "DB 오류";
  return status === "FAILED" ? "기타 오류" : `${status}`;
}
