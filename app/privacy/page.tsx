import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { getSiteSettings } from "@/lib/domain/siteSettings";

export async function generateMetadata(): Promise<Metadata> {
  const { serviceName } = await getSiteSettings();
  return { title: `개인정보 처리방침 - ${serviceName ?? "올인픽"}` };
}

/** Shown in place of operator facts an admin hasn't entered yet (admins see a warning at /admin). */
const NOT_SET = "준비 중";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
    </section>
  );
}

function Table({ head, rows, wide = false }: { head: string[]; rows: ReactNode[][]; wide?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className={`w-full text-left text-sm ${wide ? "min-w-[520px]" : ""}`}>
        <thead className="bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function PrivacyPage() {
  const site = await getSiteSettings();
  const serviceName = site.serviceName ?? "올인픽";
  const operatorName = site.operatorName ?? `${serviceName} 운영자`;
  const privacyOfficerName = site.privacyOfficerName ?? NOT_SET;
  const contactEmail = site.contactEmail ?? NOT_SET;
  const privacyPolicyEffectiveDate = site.privacyEffectiveDate ?? NOT_SET;

  return (
    <article className="mx-auto flex w-full max-w-2xl flex-col gap-8 break-keep py-4">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">개인정보 처리방침</h1>
        <p className="text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
          {operatorName}(이하 &quot;운영자&quot;)는 {serviceName} 서비스를 운영하면서 이용자의 개인정보를
          「개인정보 보호법」에 따라 안전하게 처리합니다. 이 방침은 어떤 정보를, 왜, 얼마나 오래 보관하는지
          알려드리기 위한 것입니다.
        </p>
      </header>

      <Section title="1. 수집하는 개인정보와 이용 목적">
        <p>
          상품 검색과 가격 확인은 로그인 없이 이용할 수 있으며, 이때는 개인정보를 수집하지 않습니다. 관심 상품 등록과
          가격 알림을 이용하려면 로그인이 필요하고, 그때 아래 정보를 수집합니다.
        </p>
        <Table
          wide
          head={["구분", "수집 항목", "이용 목적"]}
          rows={[
            ["Google 로그인", "이름, 이메일 주소, Google 회원 식별번호", "회원 식별, 로그인 유지"],
            [
              "카카오 로그인",
              "닉네임, 이메일 주소(동의한 경우에만), 카카오 회원 식별번호, 카카오톡 메시지 발송용 인증 토큰",
              "회원 식별, 로그인 유지, 카카오톡 가격 알림 발송",
            ],
            [
              "서비스 이용 중 생성",
              "관심 상품 목록, 목표 가격, 알림 내역, 로그인 세션 정보",
              "가격 변동 확인, 가격 하락 및 목표가 도달 알림 제공",
            ],
            [
              "기기 알림을 켠 경우",
              "브라우저 알림 수신 주소와 암호화 키, 브라우저 정보",
              "휴대폰·PC 알림으로 가격 알림 발송",
            ],
            ["자동 생성", "서비스 오류 기록(발생 시각, 요청 주소, 회원 식별자)", "장애 원인 파악과 서비스 안정성 개선"],
          ]}
        />
        <p>운영자는 비밀번호, 결제 정보, 주민등록번호를 수집하지 않습니다.</p>
      </Section>

      <Section title="2. 보유 및 이용 기간">
        <p>
          회원 정보와 이용 기록은 회원이 탈퇴를 요청할 때까지 보관하고, 요청을 받으면 지체 없이 파기합니다. 로그인
          세션은 2시간 동안 사용하지 않으면 만료되며, &quot;로그인 상태 유지&quot;를 선택한 경우 30일 동안 사용하지
          않거나 로그인 후 90일이 지나면 만료됩니다. 오류 기록은 원인을 확인하고 조치를 마친 뒤 정리합니다.
        </p>
      </Section>

      <Section title="3. 개인정보의 제3자 제공">
        <p>
          운영자는 이용자의 개인정보를 제3자에게 제공하지 않습니다. 다만 법령에 따라 수사기관 등이 적법한 절차로 요청하는
          경우는 예외로 합니다.
        </p>
      </Section>

      <Section title="4. 개인정보 처리 위탁 및 국외 이전">
        <p>서비스 운영을 위해 아래 업체에 개인정보 처리를 맡기고 있으며, 일부는 해외에 있는 서버에 저장됩니다.</p>
        <Table
          wide
          head={["업체", "위탁 업무", "이전 국가", "이전 항목", "보유 기간"]}
          rows={[
            ["Vercel Inc.", "웹사이트 호스팅, 서버 운영", "미국", "서비스 이용 중 전송되는 모든 정보", "회원 탈퇴 시 또는 위탁 계약 종료 시까지"],
            ["Turso", "데이터베이스 저장", "미국 등 데이터센터 소재국", "1번 항목의 모든 정보", "회원 탈퇴 시 또는 위탁 계약 종료 시까지"],
            ["(주)카카오", "카카오톡 가격 알림 발송", "대한민국", "카카오 회원 식별번호, 알림 내용", "발송 완료 시까지"],
            [
              "브라우저 알림 서비스 (Google, Apple, Mozilla 등 이용자의 브라우저 제조사)",
              "기기 알림 전달",
              "미국 등",
              "알림 수신 주소, 알림 내용",
              "전달 완료 시까지 (최대 1일)",
            ],
          ]}
        />
        <p>
          국외 이전은 서비스 이용 시 네트워크를 통해 수시로 이루어집니다. 국외 이전을 원하지 않으시면 로그인하지 않고
          서비스를 이용하시거나 아래 연락처로 탈퇴를 요청하실 수 있습니다. 이 경우 관심 상품 등록과 가격 알림은 이용할 수
          없습니다.
        </p>
      </Section>

      <Section title="5. 쿠키 사용">
        <p>
          로그인 상태를 유지하기 위한 세션 쿠키(브라우저를 닫으면 삭제, &quot;로그인 상태 유지&quot; 선택 시 최대 90일)와, 로그인 과정의 보안 확인용 쿠키(10분)만 사용합니다. 광고나
          행동 분석 목적의 쿠키는 사용하지 않습니다. 브라우저 설정에서 쿠키를 차단할 수 있지만, 이 경우 로그인이 필요한
          기능은 이용할 수 없습니다.
        </p>
      </Section>

      <Section title="6. 이용자의 권리와 행사 방법">
        <p>
          이용자는 언제든지 자신의 개인정보 열람, 정정, 삭제, 처리 정지를 요청할 수 있습니다. 아래 연락처로 요청하시면
          본인 확인 후 지체 없이 처리합니다. 카카오톡 알림만 중단하려면 카카오 계정의 연결된 서비스 관리에서
          {` ${serviceName} `}연결을 해제하시면 됩니다. 기기 알림은 내 관심상품 화면의 &quot;알림 끄기&quot;를 누르면
          꺼지고 해당 기기의 알림 수신 정보가 삭제됩니다. 브라우저 설정에서 알림을 차단해도 더 이상 알림이 오지 않습니다.
        </p>
      </Section>

      <Section title="7. 개인정보의 파기">
        <p>
          보유 기간이 끝나거나 처리 목적을 달성한 개인정보는 지체 없이 데이터베이스에서 복구할 수 없도록 삭제합니다.
        </p>
      </Section>

      <Section title="8. 안전성 확보 조치">
        <p>
          모든 통신은 암호화(HTTPS)되며, 로그인 세션은 추측할 수 없는 무작위 값으로 관리합니다. 관리자 기능은 지정된 관리자
          계정만 사용할 수 있고, 데이터베이스는 인증 토큰이 있어야만 접근할 수 있습니다.
        </p>
      </Section>

      <Section title="9. 만 14세 미만 아동">
        <p>이 서비스는 만 14세 미만 아동을 대상으로 하지 않으며, 만 14세 미만 아동의 개인정보를 알고 수집하지 않습니다.</p>
      </Section>

      <Section title="10. 개인정보 보호책임자">
        <Table
          head={["구분", "내용"]}
          rows={[
            ["개인정보 보호책임자", privacyOfficerName],
            ["연락처", contactEmail],
          ]}
        />
        <p>
          개인정보 침해에 대한 신고나 상담이 필요하시면 개인정보침해신고센터(국번 없이 118, privacy.kisa.or.kr) 또는
          개인정보분쟁조정위원회(1833-6972, www.kopico.go.kr)에 문의하실 수 있습니다.
        </p>
      </Section>

      <Section title="11. 처리방침의 변경">
        <p>이 방침의 내용이 바뀌면 시행 7일 전부터 이 페이지를 통해 알려드립니다.</p>
        <p>시행일: {privacyPolicyEffectiveDate}</p>
      </Section>

      <Link href="/" className="text-sm text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100">
        홈으로 돌아가기
      </Link>
    </article>
  );
}
