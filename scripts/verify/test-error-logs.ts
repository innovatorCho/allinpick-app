/**
 * Unit tests for the admin error log (lib/domain/errorLogs.ts, /admin/errors).
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-error-logs.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-error-logs.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { ensureUsersSeeded } from "@/lib/domain/users";
import {
  recordError,
  listErrorLogs,
  countErrorLogs,
  resolveErrorLog,
  reopenErrorLog,
  deleteResolvedErrorLogsOlderThan,
} from "@/lib/domain/errorLogs";
import { loginErrorMessage, LOGIN_ERROR_MESSAGES } from "@/lib/auth/loginErrors";
import { getDb } from "@/lib/db/client";

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

// recordError prints every error to the console by design; keep test output readable.
const originalConsoleError = console.error;
console.error = (...args: unknown[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("[error-log]")) return;
  originalConsoleError(...args);
};

async function main() {
  await ensureUsersSeeded();

  await test("records message, stack, path, user, digest and context", async () => {
    await recordError({
      source: "action:registerProduct",
      error: new TypeError("boom"),
      path: "POST /",
      userId: "user-a",
      digest: "12345",
      context: { url: "https://example.com" },
    });
    const [log] = await listErrorLogs("open");
    assert.equal(log.source, "action:registerProduct");
    assert.equal(log.message, "TypeError: boom");
    assert.ok(log.stack?.includes("boom"));
    assert.equal(log.path, "POST /");
    assert.equal(log.userName, "사용자 A");
    assert.equal(log.digest, "12345");
    assert.deepEqual(JSON.parse(log.context!), { url: "https://example.com" });
  });

  await test("non-Error values are recorded too", async () => {
    await recordError({ source: "scheduler:cycle", error: "plain string failure" });
    await recordError({ source: "scheduler:cycle", error: { code: 42 } });
    const logs = await listErrorLogs("open");
    assert.ok(logs.some((l) => l.message === "plain string failure"));
    assert.ok(logs.some((l) => l.message === '{"code":42}'));
  });

  await test("very long messages are truncated", async () => {
    await recordError({ source: "scheduler:cycle", error: new Error("x".repeat(5000)) });
    const [log] = await listErrorLogs("open", { limit: 1 });
    assert.ok(log.message.length < 2100);
    assert.ok(log.message.endsWith("…(생략)"));
  });

  await test("digest search finds the row a shopper's error code points to", async () => {
    const found = await listErrorLogs("all", { digest: "12345" });
    assert.equal(found.length, 1);
    assert.equal((await listErrorLogs("all", { digest: "nope" })).length, 0);
  });

  await test("repeated identical errors are counted and resolved together", async () => {
    for (let i = 0; i < 3; i += 1) {
      await recordError({ source: "request:render", error: new Error("DB down") });
    }
    const repeated = (await listErrorLogs("open")).filter((l) => l.message === "Error: DB down");
    assert.equal(repeated.length, 3);
    assert.ok(repeated.every((l) => l.sameMessageOpenCount === 3));

    const before = await countErrorLogs();
    const changed = await resolveErrorLog({ id: repeated[0].id, adminUserId: "admin", note: "Turso 토큰 교체", includeSameMessage: true });
    assert.equal(changed, 3);
    const after = await countErrorLogs();
    assert.equal(after.open, before.open - 3);
    assert.equal(after.resolved, before.resolved + 3);

    const resolved = (await listErrorLogs("resolved")).find((l) => l.id === repeated[0].id)!;
    assert.equal(resolved.resolvedByName, "관리자");
    assert.equal(resolved.resolutionNote, "Turso 토큰 교체");
  });

  await test("resolving a single row leaves its duplicates open", async () => {
    await recordError({ source: "request:render", error: new Error("dup") });
    await recordError({ source: "request:render", error: new Error("dup") });
    const dups = (await listErrorLogs("open")).filter((l) => l.message === "Error: dup");
    assert.equal(await resolveErrorLog({ id: dups[0].id, adminUserId: "admin", note: null, includeSameMessage: false }), 1);
    assert.equal((await listErrorLogs("open")).filter((l) => l.message === "Error: dup").length, 1);
  });

  await test("reopen puts a resolved row back in the open list", async () => {
    const [resolved] = await listErrorLogs("resolved", { limit: 1 });
    await reopenErrorLog(resolved.id);
    const reopened = (await listErrorLogs("open")).find((l) => l.id === resolved.id)!;
    assert.equal(reopened.resolvedAt, null);
    assert.equal(reopened.resolutionNote, null);
  });

  await test("cleanup deletes only old resolved rows, never open ones", async () => {
    const db = await getDb();
    await db.prepare(`UPDATE error_logs SET resolved_at = '2000-01-01T00:00:00.000Z' WHERE resolved_at IS NOT NULL`).run();
    const before = await countErrorLogs();
    const deleted = await deleteResolvedErrorLogsOlderThan(30);
    assert.equal(deleted, before.resolved);
    const after = await countErrorLogs();
    assert.equal(after.resolved, 0);
    assert.equal(after.open, before.open);
  });

  await test("login page only shows fixed messages, never query-string text", () => {
    assert.equal(loginErrorMessage(undefined), null);
    assert.equal(loginErrorMessage(""), null);
    assert.equal(loginErrorMessage("cancelled"), LOGIN_ERROR_MESSAGES.cancelled);
    assert.equal(loginErrorMessage("<script>피싱 문구</script>"), LOGIN_ERROR_MESSAGES.failed);
    assert.equal(loginErrorMessage(["a", "b"]), null);
  });

  console.error = originalConsoleError;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
