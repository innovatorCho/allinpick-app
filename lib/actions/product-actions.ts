"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import {
  InvalidOliveYoungUrlError,
  registerProductForUser,
} from "@/lib/domain/collection";

export interface RegisterFormState {
  error?: string;
}

/**
 * Registers a product URL for the current test user (AGENTS.md §11, STEP 2/3).
 * Runs one collection attempt immediately; a failed collection is not an
 * error here — the product is still created/linked and the detail page
 * shows the failure state (AGENTS.md §4).
 */
export async function registerProductAction(
  _prevState: RegisterFormState | undefined,
  formData: FormData
): Promise<RegisterFormState> {
  const url = String(formData.get("url") ?? "").trim();
  if (!url) {
    return { error: "올리브영 상품 URL을 입력해주세요." };
  }

  const user = await getCurrentUser();
  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  let productId: string;
  try {
    const result = await registerProductForUser(url, user.id);
    productId = result.product.id;
  } catch (err) {
    if (err instanceof InvalidOliveYoungUrlError) {
      return { error: err.message };
    }
    return { error: err instanceof Error ? err.message : "상품 등록 중 오류가 발생했습니다." };
  }

  revalidatePath("/", "layout");
  redirect(`/product/${productId}`);
}
