"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  countUnread,
  listRecentNotificationsForUser,
  markAllRead,
  markNotificationRead,
  type UserNotificationItem,
} from "@/lib/domain/notifications";

/** How many recent notifications the modal shows. */
const MODAL_LIMIT = 50;

export async function loadMyNotificationsAction(): Promise<{ items: UserNotificationItem[]; unread: number }> {
  const user = await requireUser();
  const [items, unread] = await Promise.all([listRecentNotificationsForUser(user.id, MODAL_LIMIT), countUnread(user.id)]);
  return { items, unread };
}

// Revalidates the layout too: the unread badge on the header bell lives there.
export async function markNotificationReadAction(notificationId: number): Promise<void> {
  const user = await requireUser();
  await markNotificationRead(notificationId, user.id);
  revalidatePath("/", "layout");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/", "layout");
}
