import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCodeForProfile } from "@/lib/auth/providers";
import { isAdminEmail } from "@/lib/auth/adminAllowlist";
import { createOAuthUser, findUserByOAuthAccount, updateOAuthTokens } from "@/lib/domain/users";
import { createSessionForUser } from "@/lib/session";
import { recordError } from "@/lib/domain/errorLogs";
import { loginErrorPath, type LoginErrorCode } from "@/lib/auth/loginErrors";
import type { OAuthProvider } from "@/lib/domain/types";

const STATE_COOKIE = "allinpick_oauth_state";

function isSupportedProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "kakao";
}

function loginError(request: NextRequest, code: LoginErrorCode) {
  return NextResponse.redirect(new URL(loginErrorPath(code), request.url));
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isSupportedProvider(provider)) {
    return loginError(request, "unsupported");
  }

  const searchParams = request.nextUrl.searchParams;
  const providerError = searchParams.get("error");
  if (providerError) {
    return loginError(request, "cancelled");
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");

  const store = await cookies();
  const expectedState = store.get(STATE_COOKIE)?.value;
  store.delete(STATE_COOKIE);

  if (!code || !state || !expectedState || state !== expectedState) {
    return loginError(request, "expired");
  }

  let profile, tokens;
  try {
    ({ profile, tokens } = await exchangeCodeForProfile(provider, code));
  } catch (err) {
    await recordError({ source: "auth:token-exchange", error: err, path: `GET /api/auth/callback/${provider}`, context: { provider } });
    return loginError(request, "failed");
  }

  try {
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
  } catch (err) {
    await recordError({ source: "auth:create-session", error: err, path: `GET /api/auth/callback/${provider}`, context: { provider } });
    return loginError(request, "failed");
  }
  return NextResponse.redirect(new URL("/", request.url));
}
