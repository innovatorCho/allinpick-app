/**
 * Unit tests for the OAuth user/admin-allowlist logic (lib/domain/users.ts,
 * lib/auth/adminAllowlist.ts). Session-cookie logic (lib/session.ts) isn't
 * covered here — it calls next/headers' cookies(), which only works inside
 * an actual Next.js request and throws in a plain Node script; that was
 * verified live instead (see chat history for the browser walkthrough).
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-auth.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-auth.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { isAdminEmail } from "@/lib/auth/adminAllowlist";
import { createOAuthUser, findUserByOAuthAccount, listOAuthAccountsForUser } from "@/lib/domain/users";

const dbPath = process.env.DATABASE_PATH;
if (!dbPath) throw new Error("Set DATABASE_PATH before running this script.");
if (existsSync(dbPath)) rmSync(dbPath);

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

async function main() {
  await test("isAdminEmail: 목록이 비어있으면 항상 false", () => {
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminEmail("me@example.com"), false);
  });

  await test("isAdminEmail: 목록에 있으면 true, 대소문자 무시", () => {
    process.env.ADMIN_EMAILS = "Owner@Example.com, other@x.com";
    assert.equal(isAdminEmail("owner@example.com"), true);
    assert.equal(isAdminEmail("OTHER@X.COM"), true);
    assert.equal(isAdminEmail("random@x.com"), false);
  });

  await test("isAdminEmail: 이메일이 null이면 false", () => {
    process.env.ADMIN_EMAILS = "owner@example.com";
    assert.equal(isAdminEmail(null), false);
  });

  await test("createOAuthUser: 새 사용자 생성 + oauth_accounts 연결", async () => {
    const user = await createOAuthUser({
      provider: "google",
      providerUserId: "g-123",
      email: "test@example.com",
      name: "테스트유저",
      isAdmin: false,
    });
    assert.equal(user.name, "테스트유저");
    assert.equal(user.email, "test@example.com");
    assert.equal(user.role, "user");

    const found = await findUserByOAuthAccount("google", "g-123");
    assert.equal(found?.id, user.id);

    const accounts = await listOAuthAccountsForUser(user.id);
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].provider, "google");
    assert.equal(accounts[0].provider_user_id, "g-123");
  });

  await test("createOAuthUser: ADMIN_EMAILS에 해당하면 admin 역할로 생성됨", async () => {
    const user = await createOAuthUser({
      provider: "google",
      providerUserId: "g-admin-1",
      email: "owner@example.com",
      name: "관리자후보",
      isAdmin: isAdminEmail("owner@example.com"),
    });
    assert.equal(user.role, "admin");
  });

  await test("서로 다른 provider는 같은 이메일이어도 별개 계정으로 생성됨 (계정 연동 안 함)", async () => {
    const googleUser = await createOAuthUser({
      provider: "google",
      providerUserId: "g-999",
      email: "shared@example.com",
      name: "구글사용자",
      isAdmin: false,
    });
    const kakaoUser = await createOAuthUser({
      provider: "kakao",
      providerUserId: "k-999",
      email: "shared@example.com",
      name: "카카오사용자",
      isAdmin: false,
    });
    assert.notEqual(googleUser.id, kakaoUser.id);
  });

  await test("findUserByOAuthAccount: 존재하지 않는 계정은 null", async () => {
    assert.equal(await findUserByOAuthAccount("kakao", "no-such-id"), null);
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
