import type { OAuthProvider } from "@/lib/domain/types";

/**
 * Minimal hand-rolled OAuth2 "Authorization Code" flow for Google and Kakao —
 * no auth library dependency, consistent with this project's preference for
 * built-ins over abstraction layers (see AGENTS.md §18/§25).
 *
 * Deliberately does NOT link accounts across providers by email: identity is
 * always (provider, provider_user_id) — see lib/db/schema.ts's oauth_accounts
 * doc comment for why.
 */

interface ProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scope: string | null;
  clientId: string;
  clientSecret: string;
}

export class OAuthConfigError extends Error {}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value === "TODO") {
    throw new OAuthConfigError(`${name} 환경변수가 설정되지 않았습니다.`);
  }
  return value;
}

export function getBaseUrl(): string {
  // Strip trailing slashes so "https://x.app/" doesn't yield "https://x.app//api/..."
  return (process.env.APP_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export function redirectUriFor(provider: OAuthProvider): string {
  return `${getBaseUrl()}/api/auth/callback/${provider}`;
}

function configFor(provider: OAuthProvider): ProviderConfig {
  if (provider === "google") {
    return {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      userInfoUrl: "https://www.googleapis.com/oauth2/v3/userinfo",
      scope: "openid email profile",
      clientId: requireEnv("GOOGLE_CLIENT_ID"),
      clientSecret: requireEnv("GOOGLE_CLIENT_SECRET"),
    };
  }
  return {
    authorizeUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    userInfoUrl: "https://kapi.kakao.com/v2/user/me",
    // talk_message: needed for "나에게 보내기" (lib/kakaoMessaging.ts). This
    // consent item must be turned on in the Kakao Developers console (카카오
    // 로그인 → 동의항목 → 카카오톡 메시지 전송) or the authorize request itself
    // errors — a prerequisite the user completes on their end, not something
    // this code can turn on for them.
    scope: "talk_message",
    clientId: requireEnv("KAKAO_CLIENT_ID"),
    clientSecret: requireEnv("KAKAO_CLIENT_SECRET"),
  };
}

export function buildAuthorizeUrl(provider: OAuthProvider, state: string): string {
  const config = configFor(provider);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUriFor(provider),
    response_type: "code",
    state,
  });
  if (config.scope) params.set("scope", config.scope);
  if (provider === "google") params.set("prompt", "select_account");
  return `${config.authorizeUrl}?${params.toString()}`;
}

export interface OAuthProfile {
  providerUserId: string;
  email: string | null;
  name: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string | null;
  /** ISO timestamp; null if the provider didn't say how long the token lasts. */
  expiresAt: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractProfile(provider: OAuthProvider, json: any): OAuthProfile {
  if (provider === "google") {
    return {
      providerUserId: String(json.sub),
      email: typeof json.email === "string" ? json.email : null,
      name: typeof json.name === "string" ? json.name : "사용자",
    };
  }

  const account = json.kakao_account ?? {};
  const profile = account.profile ?? {};
  return {
    providerUserId: String(json.id),
    email: typeof account.email === "string" ? account.email : null,
    name: typeof profile.nickname === "string" ? profile.nickname : "사용자",
  };
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number; // seconds
}

function toTokens(json: TokenResponse): OAuthTokens {
  if (!json.access_token) {
    throw new Error("access_token을 받지 못했습니다.");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

export async function exchangeCodeForProfile(
  provider: OAuthProvider,
  code: string
): Promise<{ profile: OAuthProfile; tokens: OAuthTokens }> {
  const config = configFor(provider);

  const tokenRes = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: redirectUriFor(provider),
      code,
    }),
  });
  if (!tokenRes.ok) {
    throw new Error(`토큰 교환에 실패했습니다 (HTTP ${tokenRes.status}).`);
  }
  const tokens = toTokens(await tokenRes.json());

  const profileRes = await fetch(config.userInfoUrl, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!profileRes.ok) {
    throw new Error(`프로필 조회에 실패했습니다 (HTTP ${profileRes.status}).`);
  }

  return { profile: extractProfile(provider, await profileRes.json()), tokens };
}

/** Kakao access tokens expire in a few hours; call this with the stored refresh_token to get a fresh one. */
export async function refreshKakaoAccessToken(refreshToken: string): Promise<OAuthTokens> {
  const config = configFor("kakao");
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    throw new Error(`토큰 갱신에 실패했습니다 (HTTP ${res.status}).`);
  }
  const json = (await res.json()) as TokenResponse;
  const tokens = toTokens(json);
  // Kakao only rotates the refresh_token sometimes; keep the old one if a new one wasn't issued.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken };
}
