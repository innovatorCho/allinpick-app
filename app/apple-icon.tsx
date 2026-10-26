import { ImageResponse } from "next/og";
import { BrandMarkSvg } from "@/components/BrandMark";

// iOS 홈 화면에 "추가"할 때 쓰이는 아이콘 — iOS가 모서리를 자체적으로
// 둥글리므로 cornerRadius=0(꽉 찬 사각 배경)으로 그림, app/icon.tsx와 다른 점은 그거 하나.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex" }}>
        <BrandMarkSvg cornerRadius={0} />
      </div>
    ),
    { ...size }
  );
}
