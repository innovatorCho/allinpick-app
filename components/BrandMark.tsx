/**
 * 올인픽 CI(심볼 마크) — "가격표 + 하락 화살표"를 겹쳐서 가격 추적 서비스라는
 * 걸 한눈에 읽히게 한 아이콘. 단순한 rect/polygon/circle로만 구성해서
 * favicon 크기(16~32px)에서도 뭉개지지 않게 했고, 같은 도형을 app/icon.tsx
 * (favicon/탭 아이콘), app/apple-icon.tsx(iOS 홈 화면), 그리고 홈 화면
 * 로고(app/page.tsx)에서 전부 재사용한다 — 세 군데가 서로 다른 그림으로
 * 따로 관리되다 drift하는 일이 없도록 이 파일 하나가 유일한 원본.
 *
 * zinc-900 배경 + emerald-500 포인트 컬러는 이 앱 전체에서 "가격 하락/성공"을
 * 나타낼 때 이미 쓰고 있는 색(예: SchedulerRunResult의 SUCCESS 표시, 가격
 * 하락 상태 뱃지)과 맞춘 것 — 새 색을 끌어오지 않았다.
 */
export function BrandMarkSvg({
  cornerRadius = 22,
  background = true,
}: {
  /** 0이면 사각 배경(iOS가 자체적으로 모서리를 둥글리는 apple-icon용), 기본값은 favicon/일반 용도. */
  cornerRadius?: number;
  /** false면 배경 사각형 없이 심볼만 그림 — 홈 화면 로고처럼 이미 컬러 배경 위에 얹을 때. */
  background?: boolean;
}) {
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100">
      {background && <rect width="100" height="100" rx={cornerRadius} fill="#18181b" />}
      {/* 가격표: 펜타곤(사각형 + 뾰족한 끝) + 구멍(배경이 있으면 배경색으로 "뚫어" 보이게, 없으면 투명) */}
      <polygon points="22,30 64,30 82,50 64,70 22,70" fill="#ffffff" />
      <circle cx="34" cy="50" r="6" fill={background ? "#18181b" : "none"} />
      {/* 하락 뱃지: 초록 원 + 아래 화살표(삼각형) */}
      <circle cx="74" cy="74" r="18" fill="#10b981" />
      <polygon points="66,70 82,70 74,84" fill="#ffffff" />
    </svg>
  );
}
