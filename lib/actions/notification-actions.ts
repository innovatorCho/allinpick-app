"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { markAllRead, markNotificationRead } from "@/lib/domain/notifications";

export async function markNotificationReadAction(notificationId: number): Promise<void> {
  const user = await requireUser();
  markNotificationRead(notificationId, user.id);
  revalidatePath("/my");
}

export async function markAllNotificationsReadAction(): Promise<void> {
  const user = await requireUser();
  markAllRead(user.id);
  revalidatePath("/my");
}
