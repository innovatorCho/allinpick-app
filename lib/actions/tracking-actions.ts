"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { trackProduct, untrackProduct } from "@/lib/domain/tracking";
import { setTargetPriceForUser } from "@/lib/domain/collection";

export interface TargetPriceFormState {
  error?: string;
  /** The form offers a login button with the error. */
  needsLogin?: boolean;
  success?: boolean;
}

export async function trackProductAction(productId: string): Promise<void> {
  const user = await requireUser();
  trackProduct(user.id, productId);
  revalidatePath(`/product/${productId}`);
  revalidatePath("/my");
  revalidatePath("/");
}

export async function untrackProductAction(productId: string): Promise<void> {
  const user = await requireUser();
  untrackProduct(user.id, productId);
  revalidatePath(`/product/${productId}`);
  revalidatePath("/my");
  revalidatePath("/");
}

export async function setTargetPriceAction(
  productId: string,
  _prevState: TargetPriceFormState | undefined,
  formData: FormData
): Promise<TargetPriceFormState> {
  const raw = String(formData.get("targetPrice") ?? "").trim();
  const targetPrice = Number(raw.replace(/[^0-9]/g, ""));

  if (!raw || !Number.isFinite(targetPrice) || targetPrice <= 0) {
    return { error: "올바른 목표 가격을 입력해주세요." };
  }

  let userId: string;
  try {
    userId = (await requireUser()).id;
  } catch {
    return { error: "로그인이 만료됐어요. 다시 로그인한 뒤 목표 가격을 설정해주세요.", needsLogin: true };
  }

  setTargetPriceForUser(userId, productId, targetPrice);
  revalidatePath(`/product/${productId}`);
  revalidatePath("/my");
  return { success: true };
}
