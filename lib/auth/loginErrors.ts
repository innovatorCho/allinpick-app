/**
 * Login failures travel to /login as a short code in the query string, never
 * as message text. Two reasons: shoppers must not see raw provider/config
 * errors (those go to the admin error log instead), and the login page must
 * not print arbitrary text from a URL anyone can craft.
 */
export const LOGIN_ERROR_MESSAGES = {
  unsupported: "지원하지 않는 로그인 방식이에요.",
  cancelled: "로그인이 취소되었어요.",
  expired: "로그인 요청이 만료되었어요. 다시 시도해주세요.",
  failed: "로그인 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.",
} as const;

export type LoginErrorCode = keyof typeof LOGIN_ERROR_MESSAGES;

export function loginErrorMessage(code: unknown): string | null {
  if (typeof code !== "string" || code === "") return null;
  return LOGIN_ERROR_MESSAGES[code as LoginErrorCode] ?? LOGIN_ERROR_MESSAGES.failed;
}

export function loginErrorPath(code: LoginErrorCode): string {
  return `/login?error=${code}`;
}
