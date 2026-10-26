/**
 * Route-level loading UI (Next.js file convention) — shown instantly on
 * navigation to /search while the page is being prepared server-side, so a
 * plain <form method="GET"> submit never looks like nothing is happening.
 */
export default function Loading() {
  return <p className="text-sm text-zinc-500">불러오는 중...</p>;
}
