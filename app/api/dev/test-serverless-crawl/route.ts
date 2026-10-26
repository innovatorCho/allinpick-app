import { NextResponse, type NextRequest } from "next/server";
import {
  extractOliveYoungProductId,
  toCanonicalSourceUrl,
  InvalidOliveYoungUrlError,
} from "@/collectors/oliveyoung/identify";
import { collectOliveYoungProductServerless } from "@/collectors/oliveyoung/serverlessProductCollector";

/**
 * Standalone, database-free smoke test for the serverless-Chromium collector
 * (collectors/oliveyoung/serverlessProductCollector.ts) — "방법 C" from the
 * Vercel-migration risk discussion (see chat history). The question it
 * answers: does `@sparticuz/chromium` get past oliveyoung.co.kr's Cloudflare
 * challenge on Vercel's actual runtime? A local machine can't answer this —
 * that binary targets Lambda's Amazon-Linux-based runtime and won't even
 * execute on macOS/Windows (confirmed: `spawn ENOEXEC`).
 *
 * Deliberately touches neither the database nor a session — the rest of
 * this app can't run on Vercel yet (SQLite needs a real migration first),
 * but this one isolated route can be deployed there anyway specifically to
 * get a real answer before committing to that migration. Protected by a
 * shared-secret env var instead of admin auth for exactly that reason: admin
 * auth depends on the database this route exists to avoid needing.
 *
 * Never writes to app data — this is a feasibility probe, not a real
 * collection; nothing it does should ever reach the products table.
 */

// Hobby plan's max; without this the default (10s) wouldn't survive a cold
// browser launch + Cloudflare challenge + page load.
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const expectedSecret = process.env.SERVERLESS_CRAWL_TEST_SECRET;
  if (!expectedSecret || expectedSecret === "TODO") {
    return NextResponse.json(
      { error: "SERVERLESS_CRAWL_TEST_SECRET 환경변수가 설정되지 않았습니다." },
      { status: 500 }
    );
  }
  if (request.nextUrl.searchParams.get("secret") !== expectedSecret) {
    return NextResponse.json({ error: "인증 실패 — secret 쿼리 파라미터가 올바르지 않습니다." }, { status: 401 });
  }

  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) {
    return NextResponse.json(
      { error: "url 쿼리 파라미터가 필요합니다 (올리브영 상품 상세 URL)." },
      { status: 400 }
    );
  }

  let sourceUrl: string;
  try {
    sourceUrl = toCanonicalSourceUrl(extractOliveYoungProductId(rawUrl));
  } catch (err) {
    const message = err instanceof InvalidOliveYoungUrlError ? err.message : "URL을 확인할 수 없습니다.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const startedAt = Date.now();
  try {
    const result = await collectOliveYoungProductServerless(sourceUrl);
    return NextResponse.json({ elapsedMs: Date.now() - startedAt, result });
  } catch (err) {
    // collectOliveYoungProductServerless already catches its own failures
    // into a typed CollectResult — reaching here would mean something truly
    // unexpected (e.g. a bug in this route itself), so still report it
    // cleanly instead of a raw 500 with no body.
    return NextResponse.json(
      { elapsedMs: Date.now() - startedAt, error: err instanceof Error ? err.message : "알 수 없는 오류" },
      { status: 500 }
    );
  }
}
