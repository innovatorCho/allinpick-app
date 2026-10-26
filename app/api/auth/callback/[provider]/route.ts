import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForProfile } from "@/lib/auth/providers";
import { isAdminEmail } from "@/lib/auth/adminAllowlist";
import { createOAuthUser, findUserByOAuthAccount, updateOAuthTokens } from "@/lib/domain/users";
import { createSessionForUser } from "@/lib/session";
import type { OAuthProvider } from "@/lib/domain/types";

const STATE_COOKIE = "allinpick_oauth_state";

function isSupportedProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "kakao";
}

function loginError(request: NextRequest, message: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(message)}`, request.url));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isSupportedProvider(provider)) {
    return loginError(request, "지원하지 않는 로그인 방식입니다.");
  }

  const searchParams = request.nextUrl.searchParams;
  const providerError = searchParams.get("error");
  if (providerError) {
    return loginError(request, "로그인이 취소되었습니다.");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginError(request, "로그인 요청이 유효하지 않습니다. 다시 시도해주세요.");
  }

  let profile, tokens;
  try {
    ({ profile, tokens } = await exchangeCodeForProfile(provider, code));
  } catch (err) {
    return loginError(request, err instanceof Error ? err.message : "로그인 처리 중 오류가 발생했습니다.");
  }

  let user = await findUserByOAuthAccount(provider, profile.providerUserId);
  if (!user) {
    user = await createOAuthUser({
      provider,
      providerUserId: profile.providerUserId,
      email: profile.email,
      name: profile.name,
      isAdmin: isAdminEmail(profile.email),
      tokens,
    });
  } else {
    // Repeat login: refresh the stored tokens too — e.g. a re-login after the
    // user enables the talk_message consent item is how an existing account
    // first gets a token capable of sending KakaoTalk messages.
    await updateOAuthTokens(provider, profile.providerUserId, tokens);
  }

  await createSessionForUser(user.id);
  return NextResponse.redirect(new URL("/", request.url));
}
