import { getCurrentUser } from "@/lib/session";
import { listAllNotificationsForAdmin } from "@/lib/domain/notifications";
import { listAllUsers } from "@/lib/domain/users";
import { listAllProducts } from "@/lib/domain/products";
import { getAllKakaoTemplates, KAKAO_TEMPLATE_PLACEHOLDERS } from "@/lib/domain/kakaoTemplates";
import { listRecentKakaoSendLogs, type KakaoSendStatus } from "@/lib/domain/kakaoSendLogs";
import { listRecentKakaoDigestLogs } from "@/lib/domain/kakaoDigestLogs";
import { formatDateTime, formatKrw } from "@/lib/format";
import { NotificationTestForm } from "@/components/NotificationTestForm";
import { KakaoTemplateForm } from "@/components/KakaoTemplateForm";
import { KakaoBatchSettingsForm } from "@/components/KakaoBatchSettingsForm";
import { getKakaoBatchSettings, SUMMARY_TEMPLATE_PLACEHOLDERS } from "@/lib/domain/kakaoBatchSettings";
import type { NotificationType } from "@/lib/domain/types";

const TYPE_LABEL: Record<string, string> = {
  price_drop: "가격 하락",
  target_price: "목표가 도달",
};

const KAKAO_STATUS_BADGE: Record<KakaoSendStatus, string> = {
  sent: "rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  skipped: "rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
  failed: "rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300",
};

const KAKAO_STATUS_LABEL: Record<KakaoSendStatus, string> = {
  sent: "발송됨",
  skipped: "스킵됨",
  failed: "실패",
};

export default async function AdminNotificationsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser || currentUser.role !== "admin") {
    return <p className="text-sm text-zinc-500">관리자만 접근할 수 있습니다.</p>;
  }

  const [notifications, users, products, kakaoTemplates, kakaoSendLogs, kakaoDigestLogs, batch] = await Promise.all([
    listAllNotificationsForAdmin(),
    listAllUsers(),
    listAllProducts(),
    getAllKakaoTemplates(),
    listRecentKakaoSendLogs(),
    listRecentKakaoDigestLogs(),
    getKakaoBatchSettings(),
  ]);
  const kakaoTypes: NotificationType[] = ["price_drop", "target_price"];

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold">알림 관리 / 테스트</h1>
        <p className="mt-1 text-sm text-zinc-500">
          가격 하락·목표가 알림이 정상적으로 만들어지고 사용자 화면에 반영되는지 실제 가격 변동을 기다리지 않고
          확인할 수 있습니다.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">카카오톡 알림 묶어 보내기</h2>
          <p className="mt-1 text-sm text-zinc-500">
            가격이 내려간 상품이 여러 개여도 카카오톡은 정해진 간격에 한 통만 보내요. 상품 1개면 아래 &quot;가격
            하락&quot;·&quot;목표가 도달&quot; 템플릿으로, 2개 이상이면 요약 문구로 보내요. 웹의 알림 목록에는 상품마다
            그대로 남아요.
          </p>
        </div>
        <KakaoBatchSettingsForm
          adminValues={{
            windowMinutes: batch.sources.windowMinutes === "admin" ? String(batch.windowMinutes) : "",
            summaryTitleTemplate: batch.sources.summaryTitleTemplate === "admin" ? batch.summaryTitleTemplate : "",
            summaryTemplate: batch.sources.summaryTemplate === "admin" ? batch.summaryTemplate : "",
          }}
          effective={{
            windowMinutes: batch.windowMinutes,
            summaryTitleTemplate: batch.summaryTitleTemplate,
            summaryTemplate: batch.summaryTemplate,
          }}
          sources={batch.sources}
          placeholders={SUMMARY_TEMPLATE_PLACEHOLDERS}
        />
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">카카오톡 메시지 템플릿 관리</h2>
          <p className="mt-1 text-sm text-zinc-500">
            가격 하락·목표가 알림이 실제로 만들어질 때 카카오톡 &quot;나에게 보내기&quot;로 함께 발송되는 문구입니다.
            인앱 알림 문구와는 별개로 관리됩니다.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {kakaoTypes.map((type) => (
            <KakaoTemplateForm
              // 저장/초기화로 서버 값이 바뀌면(objectType 또는 template) 폼을 완전히 다시
              // 마운트해서 컴포넌트 내부의 로컬 편집 상태를 새 값으로 리셋시킴.
              key={`${type}:${kakaoTemplates[type].objectType}:${kakaoTemplates[type].template}`}
              type={type}
              config={kakaoTemplates[type]}
              placeholders={KAKAO_TEMPLATE_PLACEHOLDERS[type]}
            />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            최근 카카오톡 발송 이력 ({kakaoSendLogs.length}건, 최신 100건까지)
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            가격 하락·목표가 알림이 생길 때마다 시도되는 카카오톡 발송은 백그라운드(fire-and-forget)로 동작해서
            서버 콘솔을 보지 않으면 성공/실패를 알 수 없습니다 — 그 결과를 여기서 확인할 수 있습니다.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">시각</th>
                <th className="px-3 py-2">사용자</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2">종류</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">상세</th>
              </tr>
            </thead>
            <tbody>
              {kakaoSendLogs.map((log) => (
                <tr key={log.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {log.userName}
                    {log.userEmail && <span className="ml-1 text-xs text-zinc-400">({log.userEmail})</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate">{log.productName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABEL[log.type] ?? log.type}</td>
                  <td className="px-3 py-2">
                    <span className={KAKAO_STATUS_BADGE[log.status]}>{KAKAO_STATUS_LABEL[log.status]}</span>
                  </td>
                  <td className="px-3 py-2 max-w-[280px] truncate text-xs text-zinc-500">{log.detail ?? "-"}</td>
                </tr>
              ))}
              {kakaoSendLogs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    아직 카카오톡 발송 시도 이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            최근 일일 다이제스트 발송 이력 ({kakaoDigestLogs.length}건, 최신 100건까지)
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            매일 21시(KST) 이후, 그날 가격 하락 알림을 1건이라도 받은 사용자에게 &quot;오늘 N개 상품 가격이
            내려갔어요&quot; 요약 메시지를 한 번만 보냅니다. 개별 알림과는 별개로 항상 함께 발송됩니다.
          </p>
        </div>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">날짜</th>
                <th className="px-3 py-2">사용자</th>
                <th className="px-3 py-2">하락 상품 수</th>
                <th className="px-3 py-2">상태</th>
                <th className="px-3 py-2">상세</th>
              </tr>
            </thead>
            <tbody>
              {kakaoDigestLogs.map((log) => (
                <tr key={log.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{log.digestDate}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {log.userName}
                    {log.userEmail && <span className="ml-1 text-xs text-zinc-400">({log.userEmail})</span>}
                  </td>
                  <td className="px-3 py-2">{log.dropCount}개</td>
                  <td className="px-3 py-2">
                    <span className={KAKAO_STATUS_BADGE[log.status]}>{KAKAO_STATUS_LABEL[log.status]}</span>
                  </td>
                  <td className="px-3 py-2 max-w-[280px] truncate text-xs text-zinc-500">{log.detail ?? "-"}</td>
                </tr>
              ))}
              {kakaoDigestLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                    아직 발송된 다이제스트가 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">테스트 알림 생성</h2>
        {products.length === 0 ? (
          <p className="text-sm text-zinc-500">등록된 상품이 없어 테스트 알림을 만들 수 없습니다. 먼저 상품을 등록해주세요.</p>
        ) : (
          <NotificationTestForm users={users} products={products} />
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          전체 알림 로그 ({notifications.length}건, 최신 100건까지)
        </h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
              <tr>
                <th className="px-3 py-2">시각</th>
                <th className="px-3 py-2">사용자</th>
                <th className="px-3 py-2">상품</th>
                <th className="px-3 py-2">종류</th>
                <th className="px-3 py-2">메시지</th>
                <th className="px-3 py-2">읽음</th>
              </tr>
            </thead>
            <tbody>
              {notifications.map((n) => (
                <tr key={n.id} className="border-t border-zinc-100 dark:border-zinc-900">
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{formatDateTime(n.createdAt)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {n.userName}
                    {n.userEmail && <span className="ml-1 text-xs text-zinc-400">({n.userEmail})</span>}
                  </td>
                  <td className="px-3 py-2 max-w-[160px] truncate">{n.productName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{TYPE_LABEL[n.type] ?? n.type}</td>
                  <td className="px-3 py-2">
                    {n.message}
                    {(n.oldPrice != null || n.newPrice != null) && (
                      <span className="ml-1 text-xs text-zinc-400">
                        ({formatKrw(n.oldPrice)} → {formatKrw(n.newPrice)})
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {n.isRead ? (
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                        읽음
                      </span>
                    ) : (
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                        안 읽음
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {notifications.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-zinc-500">
                    아직 생성된 알림이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
