import { ImageResponse } from "next/og";
import { BrandMarkSvg } from "@/components/BrandMark";

// 브라우저 탭/즐겨찾기에 쓰이는 아이콘 — app/favicon.ico(구형 브라우저 대비 그대로 둠)보다
// 우선 적용됨. components/BrandMark.tsx가 유일한 원본 도형이고 여긴 그걸 PNG로 굽기만 함.
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <BrandMarkSvg />
      </div>
    ),
    { ...size }
  );
}
