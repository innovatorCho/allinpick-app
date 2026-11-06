"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { setCuratorUrl, getProductById, deleteProduct, markDueNow } from "@/lib/domain/products";
import { recollectProduct } from "@/lib/domain/collection";
import { withLoggedCollection } from "@/lib/collectionRun";
import { canCollectHere } from "@/lib/collectMode";
import { collectOliveYoungProductServerless } from "@/collectors/oliveyoung/serverlessProductCollector";
import { generateSampleData } from "@/lib/domain/seed";
import { runSchedulerNow, updateSchedulerConfig } from "@/lib/priceScheduler";
import { createNotification } from "@/lib/domain/notifications";
import { setKakaoTemplate, resetKakaoTemplate } from "@/lib/domain/kakaoTemplates";
import { DbConnectionError, DbConfigError } from "@/lib/db/client";
import {
  recordError,
  resolveErrorLog,
  reopenErrorLog,
  deleteResolvedErrorLogsOlderThan,
} from "@/lib/domain/errorLogs";
import { saveSiteSettings, SITE_SETTING_FIELDS, type SiteSettingKey } from "@/lib/domain/siteSettings";
import type { NotificationType } from "@/lib/domain/types";

/** Shared across every FormState-returning action below — a DB-connection
 * failure (network blip to Turso) shouldn't surface as a raw stack trace;
 * it's a normal, expected, retry-worthy condition, same as a crawl failure. */
function dbErrorMessage(err: unknown): string | null {
  if (err instanceof DbConnectionError || err instanceof DbConfigError) {
    return "데이터베이스에 일시적으로 연결할 수 없습니다. 잠시 후 다시 시도해주세요.";
  }
  return null;
}

export interface CuratorUrlFormState {
  error?: string;
  success?: boolean;
}

export async function setCuratorUrlAction(
  productId: string,
  _prevState: CuratorUrlFormState | undefined,
  formData: FormData
): Promise<CuratorUrlFormState> {
  await requireAdmin();

  const raw = String(formData.get("curatorUrl") ?? "").trim();
  if (raw) {
    try {
      new URL(raw);
    } catch {
      return { error: "올바른 URL 형식이 아닙니다." };
    }
  }

  try {
    await setCuratorUrl(productId, raw || null);
  } catch (err) {
    const message = dbErrorMessage(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/product/${productId}`);
  revalidatePath("/admin");
  return { success: true };
}

export interface RecollectState {
  error?: string;
  status?: string;
}

export async function recollectProductAction(productId: string): Promise<void> {
  await requireAdmin();
  if (canCollectHere()) {
    await withLoggedCollection("recollect", `가격 다시 확인 · ${productId}`, () => recollectProduct(productId));
  } else {
    await markDueNow(productId); // the collector worker picks it up on its next pass (lib/collectMode.ts)
  }
  revalidatePath(`/admin/products/${productId}`);
  revalidatePath(`/product/${productId}`);
  revalidatePath("/admin");
  revalidatePath("/");
}

export interface DeleteProductState {
  error?: string;
}

/** Admin "상품 삭제": removes the product with its history and every user's tracking of it. */
export async function deleteProductAction(productId: string): Promise<DeleteProductState> {
  await requireAdmin();
  try {
    await deleteProduct(productId);
  } catch (err) {
    await recordError({ source: "action:deleteProduct", error: err, context: { productId } });
    return { error: dbErrorMessage(err) ?? "상품을 삭제하지 못했습니다. 오류 로그를 확인해주세요." };
  }
  revalidatePath("/", "layout");
  redirect("/admin");
}

/** Dev-only sample data generator, wired to an admin-screen button (AGENTS.md §16). */
export async function generateSampleDataAction(): Promise<void> {
  await requireAdmin();
  if (process.env.NODE_ENV === "production") {
    throw new Error("샘플 데이터 생성은 개발 환경에서만 사용할 수 있습니다.");
  }
  await generateSampleData();
  revalidatePath("/", "layout");
}

export interface SchedulerConfigFormState {
  error?: string;
  success?: boolean;
}

export async function updateSchedulerConfigAction(
  _prevState: SchedulerConfigFormState | undefined,
  formData: FormData
): Promise<SchedulerConfigFormState> {
  await requireAdmin();

  const minutesRaw = String(formData.get("intervalMinutes") ?? "").trim();
  const concurrencyRaw = String(formData.get("concurrency") ?? "").trim();
  const minutes = Number(minutesRaw);
  const concurrency = Number(concurrencyRaw);

  if (!minutesRaw || !Number.isFinite(minutes) || minutes <= 0) {
    return { error: "올바른 주기(분)를 입력해주세요." };
  }
  if (!concurrencyRaw || !Number.isInteger(concurrency)) {
    return { error: "올바른 동시 처리 개수를 입력해주세요." };
  }

  const result = await updateSchedulerConfig({ intervalMs: minutes * 60_000, concurrency });
  if (result.error) return { error: result.error };

  revalidatePath("/admin/schedule");
  return { success: true };
}

export async function toggleSchedulerAction(enabled: boolean): Promise<void> {
  await requireAdmin();
  await updateSchedulerConfig({ enabled });
  revalidatePath("/admin/schedule");
}

export async function runSchedulerNowAction(): Promise<void> {
  await requireAdmin();
  runSchedulerNow(); // fire-and-forget — a cycle can take tens of seconds; the status panel reflects progress on refresh
  revalidatePath("/admin/schedule");
}

export interface TestNotificationFormState {
  error?: string;
  success?: boolean;
}

/**
 * Admin-only tool to manually create a notification for any (user, product)
 * pair — lets the notification pipeline (unread badge, /my list, mark-read)
 * be tested on demand instead of only by waiting for a real price drop.
 */
export async function createTestNotificationAction(
  _prevState: TestNotificationFormState | undefined,
  formData: FormData
): Promise<TestNotificationFormState> {
  await requireAdmin();

  const userId = String(formData.get("userId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const type = String(formData.get("type") ?? "") as NotificationType;
  const message = String(formData.get("message") ?? "").trim();

  if (!userId) return { error: "사용자를 선택해주세요." };
  if (!productId) return { error: "상품을 선택해주세요." };
  if (type !== "price_drop" && type !== "target_price") return { error: "알림 종류를 선택해주세요." };
  if (!message) return { error: "메시지를 입력해주세요." };

  const oldPriceRaw = String(formData.get("oldPrice") ?? "").trim();
  const newPriceRaw = String(formData.get("newPrice") ?? "").trim();
  const targetPriceRaw = String(formData.get("targetPrice") ?? "").trim();
  const sendKakao = formData.get("sendKakao") === "on";

  try {
    await createNotification({
      userId,
      productId,
      type,
      message: `${message} (관리자 테스트 알림)`,
      oldPrice: oldPriceRaw ? Number(oldPriceRaw) : null,
      newPrice: newPriceRaw ? Number(newPriceRaw) : null,
      targetPrice: targetPriceRaw ? Number(targetPriceRaw) : null,
      sendKakao,
    });
  } catch (err) {
    const message = dbErrorMessage(err);
    if (message) return { error: message };
    throw err;
  }

  revalidatePath("/admin/notifications");
  revalidatePath("/my");
  return { success: true };
}

export interface KakaoTemplateFormState {
  error?: string;
  success?: boolean;
}

/** Admin edits a KakaoTalk message template for one notification type (lib/domain/kakaoTemplates.ts). */
export async function updateKakaoTemplateAction(
  _prevState: KakaoTemplateFormState | undefined,
  formData: FormData
): Promise<KakaoTemplateFormState> {
  await requireAdmin();

  const type = String(formData.get("type") ?? "") as NotificationType;
  const template = String(formData.get("template") ?? "");
  const objectTypeRaw = String(formData.get("objectType") ?? "text");

  if (type !== "price_drop" && type !== "target_price") return { error: "알림 종류가 올바르지 않습니다." };
  if (!template.trim()) return { error: "템플릿 내용을 입력해주세요." };
  if (objectTypeRaw !== "text" && objectTypeRaw !== "feed") return { error: "메시지 형식이 올바르지 않습니다." };

  try {
    await setKakaoTemplate(type, { objectType: objectTypeRaw, template });
  } catch (err) {
    const message = dbErrorMessage(err);
    if (message) return { error: message };
    throw err;
  }
  revalidatePath("/admin/notifications");
  return { success: true };
}

export async function resetKakaoTemplateAction(type: NotificationType): Promise<void> {
  await requireAdmin();
  await resetKakaoTemplate(type);
  revalidatePath("/admin/notifications");
}

export type ServerlessCollectorRunStatus = "success" | "challenge_blocked" | "error";

export interface ServerlessCollectorTestRun {
  run: number;
  status: ServerlessCollectorRunStatus;
  detail: string;
  elapsedMs: number;
}

export interface ServerlessCollectorTestReport {
  runs: ServerlessCollectorTestRun[];
  successCount: number;
  totalCount: number;
  averageElapsedMs: number;
}

export interface ServerlessCrawlerTestFormState {
  error?: string;
  report?: ServerlessCollectorTestReport;
}

const MAX_SERVERLESS_TEST_RUNS = 10;

/**
 * Admin-only, read-only experiment — see collectors/oliveyoung/serverlessProductCollector.ts.
 * Runs the serverless-sized-Chromium collector against one real product N
 * times in a row (each a fresh browser launch, simulating a cold Vercel
 * invocation) and reports success/failure/timing. Never touches the
 * product's stored data — this is purely a feasibility probe, not a real
 * collection.
 */
export async function testServerlessCollectorAction(
  _prevState: ServerlessCrawlerTestFormState | undefined,
  formData: FormData
): Promise<ServerlessCrawlerTestFormState> {
  await requireAdmin();

  const productId = String(formData.get("productId") ?? "").trim();
  const runsRaw = String(formData.get("runs") ?? "1");
  const runs = Number(runsRaw);

  if (!productId) return { error: "상품 정보가 올바르지 않습니다." };
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_SERVERLESS_TEST_RUNS) {
    return { error: `반복 횟수는 1~${MAX_SERVERLESS_TEST_RUNS} 사이여야 합니다.` };
  }

  const product = await getProductById(productId);
  if (!product) return { error: "상품을 찾을 수 없습니다." };

  const runResults: ServerlessCollectorTestRun[] = [];
  for (let run = 1; run <= runs; run++) {
    const startedAt = Date.now();
    try {
      const result = await collectOliveYoungProductServerless(product.sourceUrl);
      const elapsedMs = Date.now() - startedAt;

      if (result.status === "SUCCESS") {
        runResults.push({
          run,
          status: "success",
          detail: `${result.data.name} — ${result.data.salePrice.toLocaleString("ko-KR")}원`,
          elapsedMs,
        });
      } else if (result.error.includes("Cloudflare")) {
        runResults.push({ run, status: "challenge_blocked", detail: result.error, elapsedMs });
      } else {
        runResults.push({ run, status: "error", detail: result.error, elapsedMs });
      }
    } catch (err) {
      // 로컬(macOS 등)에서는 @sparticuz/chromium 바이너리 자체가 실행이 안 될 수 있음 —
      // 그 실행 실패 자체도 "이 환경에서는 안 된다"는 유의미한 결과라 에러로 숨기지 않고 기록.
      runResults.push({
        run,
        status: "error",
        detail: err instanceof Error ? err.message : "알 수 없는 오류",
        elapsedMs: Date.now() - startedAt,
      });
    }
  }

  const successCount = runResults.filter((r) => r.status === "success").length;
  const averageElapsedMs = Math.round(runResults.reduce((sum, r) => sum + r.elapsedMs, 0) / runResults.length);

  return { report: { runs: runResults, successCount, totalCount: runs, averageElapsedMs } };
}

// ── Error log (/admin/errors) ───────────────────────────────────────────────

const RESOLVED_ERROR_RETENTION_DAYS = 30;

export async function resolveErrorLogAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  await resolveErrorLog({
    id,
    adminUserId: admin.id,
    note,
    includeSameMessage: formData.get("includeSameMessage") === "on",
  });
  revalidatePath("/admin", "layout");
}

export async function reopenErrorLogAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = Number(formData.get("id"));
  if (!Number.isInteger(id) || id <= 0) return;
  await reopenErrorLog(id);
  revalidatePath("/admin", "layout");
}

export async function cleanupResolvedErrorLogsAction(): Promise<void> {
  await requireAdmin();
  await deleteResolvedErrorLogsOlderThan(RESOLVED_ERROR_RETENTION_DAYS);
  revalidatePath("/admin/errors");
}

// ── Site settings (/admin/settings) ─────────────────────────────────────────

export interface SiteSettingsFormState {
  error?: string;
  savedAt?: number;
  /** Echo of what was submitted. React resets a form after its action runs, so the inputs re-read their default values from this and keep what the admin typed. */
  values?: Partial<Record<SiteSettingKey, string>>;
}

export async function updateSiteSettingsAction(
  _prev: SiteSettingsFormState | undefined,
  formData: FormData
): Promise<SiteSettingsFormState> {
  await requireAdmin();
  const input: Partial<Record<SiteSettingKey, string>> = {};
  for (const field of SITE_SETTING_FIELDS) {
    const value = formData.get(field.key);
    if (typeof value === "string") input[field.key] = value;
  }
  try {
    const result = await saveSiteSettings(input);
    if (result.error) return { error: result.error, values: input };
  } catch (err) {
    const message = dbErrorMessage(err);
    if (message) return { error: message, values: input };
    throw err;
  }
  // Footer text appears on every page.
  revalidatePath("/", "layout");
  return { savedAt: Date.now(), values: input };
}
