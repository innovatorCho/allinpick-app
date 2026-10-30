"use client";

/**
 * Last-resort screen when the root layout itself fails (for example the
 * database is unreachable, since the layout loads the current user). Replaces
 * the whole document, so it carries its own <html>/<body> and inline styles:
 * globals.css is not loaded here. Same rule as app/error.tsx: no raw error
 * text, only the opaque digest.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#fafafa",
          color: "#18181b",
          padding: "0 16px",
        }}
      >
        <title>올인픽</title>
        <div style={{ maxWidth: 360, textAlign: "center" }}>
          <h1 style={{ fontSize: 18, fontWeight: 600, margin: "0 0 8px" }}>잠시 문제가 생겼어요</h1>
          <p style={{ fontSize: 14, color: "#71717a", margin: "0 0 20px", wordBreak: "keep-all" }}>
            일시적인 오류로 서비스를 불러오지 못했어요. 잠시 후 다시 시도해주세요.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              border: 0,
              borderRadius: 8,
              background: "#18181b",
              color: "#fff",
              padding: "8px 16px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            다시 시도
          </button>
          {error.digest && <p style={{ fontSize: 12, color: "#a1a1aa", marginTop: 16 }}>오류 코드: {error.digest}</p>}
        </div>
      </body>
    </html>
  );
}
