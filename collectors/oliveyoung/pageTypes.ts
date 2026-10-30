/**
 * Browser-free pieces shared by browserFetcher.ts and
 * serverlessBrowserFetcher.ts. Kept in their own module so importing them
 * never drags in a browser package. (On Vercel, the serverless fetcher used
 * to import these from browserFetcher.ts, which loaded the full `playwright`
 * package at module evaluation and crashed every route that touched a
 * collector with "Cannot find module .../playwright-core/browsers.json".)
 */
export interface RenderedPage {
  html: string;
  status: number | null;
}

export function isBotChallengePage(html: string): boolean {
  return html.includes("잠시만 기다려 주세요") || (html.includes("cloudflare") && html.toLowerCase().includes("challenge"));
}
