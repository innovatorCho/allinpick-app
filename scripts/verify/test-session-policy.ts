/**
 * Tests for the login session policy (lib/sessionPolicy.ts).
 *
 * Run with:
 *   node --experimental-strip-types --import ./scripts/verify/register.mjs scripts/verify/test-session-policy.ts
 */
import assert from "node:assert/strict";

import {
  SESSION_POLICIES,
  SESSION_TOUCH_INTERVAL_MS,
  isSessionExpired,
  nextIdleDeadline,
  sessionPolicyFor,
  type SessionTimes,
} from "@/lib/sessionPolicy";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL  ${name}`);
    console.error(err);
  }
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const login = new Date("2026-11-01T00:00:00.000Z");
const at = (ms: number) => new Date(login.getTime() + ms);
const iso = (ms: number) => at(ms).toISOString();

function freshSession(role: "user" | "admin", remember: boolean): SessionTimes {
  const p = sessionPolicyFor(role, remember);
  return {
    expiresAt: iso(p.idleTimeoutMs),
    absoluteExpiresAt: iso(p.absoluteTimeoutMs),
    lastSeenAt: iso(0),
    idleTimeoutMs: p.idleTimeoutMs,
  };
}

test("policy selection: admins never get remember-me", () => {
  assert.equal(sessionPolicyFor("user", false), SESSION_POLICIES.user);
  assert.equal(sessionPolicyFor("user", true), SESSION_POLICIES.userRemember);
  assert.equal(sessionPolicyFor("admin", true), SESSION_POLICIES.admin);
  assert.equal(SESSION_POLICIES.user.persistentCookie, false);
  assert.equal(SESSION_POLICIES.userRemember.persistentCookie, true);
  assert.equal(SESSION_POLICIES.admin.persistentCookie, false);
});

test("normal session ends after 2 hours idle", () => {
  const s = freshSession("user", false);
  assert.equal(isSessionExpired(s, at(2 * HOUR - MIN)), false);
  assert.equal(isSessionExpired(s, at(2 * HOUR)), true);
});

test("activity slides the idle deadline, but only every few minutes", () => {
  const s = freshSession("user", false);
  assert.equal(nextIdleDeadline(s, at(SESSION_TOUCH_INTERVAL_MS - 1)), null, "too soon to write again");
  const next = nextIdleDeadline(s, at(HOUR));
  assert.equal(next, iso(HOUR + 2 * HOUR));
});

test("constant use still can't pass the absolute limit (24h normal)", () => {
  const s = freshSession("user", false);
  const near = { ...s, lastSeenAt: iso(23 * HOUR), expiresAt: iso(25 * HOUR) };
  assert.equal(nextIdleDeadline({ ...near, lastSeenAt: iso(22 * HOUR) }, at(23 * HOUR)), iso(24 * HOUR), "capped at absolute");
  assert.equal(isSessionExpired(near, at(24 * HOUR)), true);
});

test("remember-me lasts 30 days idle and at most 90 days", () => {
  const s = freshSession("user", true);
  assert.equal(isSessionExpired(s, at(29 * DAY)), false);
  assert.equal(isSessionExpired(s, at(30 * DAY)), true);
  const active = { ...s, lastSeenAt: iso(80 * DAY), expiresAt: iso(110 * DAY) };
  assert.equal(isSessionExpired(active, at(89 * DAY)), false);
  assert.equal(isSessionExpired(active, at(90 * DAY)), true);
});

test("admin session: 1 hour idle, 12 hours max", () => {
  const s = freshSession("admin", true);
  assert.equal(isSessionExpired(s, at(59 * MIN)), false);
  assert.equal(isSessionExpired(s, at(HOUR)), true);
  assert.equal(isSessionExpired({ ...s, expiresAt: iso(13 * HOUR) }, at(12 * HOUR)), true);
});

test("sessions from before the policy are treated as expired", () => {
  const legacy: SessionTimes = { expiresAt: iso(30 * DAY), absoluteExpiresAt: null, lastSeenAt: null, idleTimeoutMs: null };
  assert.equal(isSessionExpired(legacy, at(MIN)), true);
  assert.equal(nextIdleDeadline(legacy, at(MIN)), null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
