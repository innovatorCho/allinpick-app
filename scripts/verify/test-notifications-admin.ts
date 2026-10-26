/**
 * Unit tests for the notification-management additions (lib/domain/notifications.ts,
 * lib/domain/users.ts) added for the admin notification test/management screen.
 *
 * Run with:
 *   DATABASE_PATH=.data/verify-notif.db node --experimental-strip-types \
 *     --import ./scripts/verify/register.mjs scripts/verify/test-notifications-admin.ts
 */
import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";

import { registerProductForUser, type Collector } from "@/lib/domain/collection";
import {
  createNotification,
  listNotificationsForUser,
  markNotificationRead,
  markAllRead,
  countUnread,
  listAllNotificationsForAdmin,
} from "@/lib/domain/notifications";
import { listAllUsers, ensureUsersSeeded } from "@/lib/domain/users";
import type { CollectResult } from "@/collectors/oliveyoung/types";

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

function stubSuccess(id: string): Collector {
  return async (sourceUrl: string): Promise<CollectResult> => ({
    status: "SUCCESS",
    sourceUrl,
    checkedAt: new Date().toISOString(),
    data: {
      oliveyoungProductId: id,
      name: `알림테스트 상품 ${id}`,
      brand: "테스트",
      imageUrl: null,
      normalPrice: 10000,
      salePrice: 10000,
      discountRate: 0,
    },
  });
}

async function main() {
  await ensureUsersSeeded();

  const productId = "NOTIF0001";
  await registerProductForUser(
    `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${productId}`,
    "user-a",
    stubSuccess(productId)
  );

  await createNotification({
    userId: "user-a",
    productId,
    type: "price_drop",
    message: "테스트 알림 1",
    oldPrice: 10000,
    newPrice: 9000,
  });
  await createNotification({
    userId: "user-b",
    productId,
    type: "target_price",
    message: "테스트 알림 2",
    oldPrice: null,
    newPrice: 9000,
  });

  await test("listAllUsers: 시딩된 테스트 사용자가 조회됨", async () => {
    const users = await listAllUsers();
    assert.ok(users.some((u) => u.id === "user-a"));
    assert.ok(users.some((u) => u.id === "admin"));
  });

  await test("listAllNotificationsForAdmin: 전체 사용자의 알림이 조회되고 사용자/상품 이름이 조인됨", async () => {
    const all = await listAllNotificationsForAdmin();
    assert.equal(all.length, 2);
    const first = all.find((n) => n.userId === "user-a");
    assert.equal(first?.productName, "알림테스트 상품 NOTIF0001");
    assert.equal(first?.userName, "사용자 A");
  });

  await test("markNotificationRead: 본인 알림만 읽음 처리되고, 다른 사용자 id로는 처리되지 않음", async () => {
    const [aNotif] = await listNotificationsForUser("user-a");
    assert.equal(aNotif.isRead, false);

    // Attempting to mark it read while impersonating a different user must be a no-op.
    await markNotificationRead(aNotif.id, "user-b");
    assert.equal((await listNotificationsForUser("user-a"))[0].isRead, false, "다른 사용자로는 읽음 처리가 되면 안 됨");

    await markNotificationRead(aNotif.id, "user-a");
    assert.equal((await listNotificationsForUser("user-a"))[0].isRead, true);
  });

  await test("markAllRead: 해당 사용자의 알림만 전부 읽음 처리, 다른 사용자는 영향 없음", async () => {
    assert.equal(await countUnread("user-b"), 1);
    await markAllRead("user-a");
    assert.equal(await countUnread("user-a"), 0);
    assert.equal(await countUnread("user-b"), 1, "user-a를 읽음 처리해도 user-b의 알림은 그대로여야 함");
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

main();
