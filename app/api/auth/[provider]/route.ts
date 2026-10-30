import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { buildAuthorizeUrl } from "@/lib/auth/providers";
import { recordError } from "@/lib/domain/errorLogs";
import { loginErrorPath } from "@/lib/auth/loginErrors";
import type { OAuthProvider } from "@/lib/domain/types";

const STATE_COOKIE = "allinpick_oauth_state";

function isSupportedProvider(value: string): value is OAuthProvider {
  return value === "google" || value === "kakao";
}

/** Starts the OAuth flow: sets a CSRF state cookie, redirects to the provider's consent screen. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!isSupportedProvider(provider)) {
    return NextResponse.redirect(new URL(loginErrorPath("unsupported"), request.url));
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
    // Usually a missing OAuth env var (OAuthConfigError) — an admin problem, not the shopper's.
    await recordError({ source: "auth:start", error: err, path: `GET /api/auth/${provider}`, context: { provider } });
    return NextResponse.redirect(new URL(loginErrorPath("failed"), request.url));
  }
}
