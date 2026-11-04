"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";
import { recordError } from "@/lib/domain/errorLogs";
import { withLoggedCollection } from "@/lib/collectionRun";
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
    const result = await withLoggedCollection("register", `상품 등록 · ${url} · 사용자 ${user.id}`, () =>
      registerProductForUser(url, user.id)
    );
    productId = result.product.id;
  } catch (err) {
    if (err instanceof InvalidOliveYoungUrlError) {
      // A validation message written for shoppers ("올리브영 상품 URL이 아닙니다" etc.), safe to show as-is.
      return { error: err.message };
    }
    await recordError({ source: "action:registerProduct", error: err, userId: user.id, context: { url } });
    return { error: "상품을 등록하지 못했어요. 잠시 후 다시 시도해주세요." };
  }

  revalidatePath("/", "layout");
  redirect(`/product/${productId}`);
}
