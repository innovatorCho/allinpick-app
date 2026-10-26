import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl, OAuthConfigError } from "@/lib/auth/providers";
import type { OAuthProvider } from "@/lib/domain/types";

const STATE_COOKIE = "allinpick_oauth_state";

function isSupportedProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "kakao";
}

/** Starts the OAuth flow: sets a CSRF state cookie, redirects to the provider's consent screen. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isSupportedProvider(provider)) {
    return NextResponse.json({ error: "지원하지 않는 로그인 방식입니다." }, { status: 400 });
  }

  const state = randomBytes(16).toString("hex");
  const store = await cookies();
  store.set(STATE_COOKIE, state, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 600, // 10 minutes — plenty for a login redirect round-trip
  });

  try {
    return NextResponse.redirect(buildAuthorizeUrl(provider, state));
  } catch (err) {
    const message = err instanceof OAuthConfigError ? err.message : "로그인을 시작할 수 없습니다.";
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, _request.url));
  }
}
