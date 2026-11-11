/** Link to the operator's KakaoTalk channel (site setting kakaoChannelUrl); renders nothing until it's set. */
export function KakaoChannelButton({ url, label, size = "md" }: { url: string | null; label: string | null; size?: "sm" | "md" }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex w-fit items-center gap-1.5 rounded-lg bg-[#FEE500] font-medium text-[#191919] hover:brightness-95 ${
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
      }`}
    >
      <svg viewBox="0 0 24 24" className={size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden>
        <path
          fill="currentColor"
          d="M12 3C6.48 3 2 6.48 2 10.77c0 2.77 1.86 5.2 4.66 6.57-.2.75-.74 2.72-.85 3.14-.13.52.19.51.4.37.17-.11 2.62-1.78 3.68-2.5.69.1 1.39.15 2.11.15 5.52 0 10-3.48 10-7.73S17.52 3 12 3z"
        />
      </svg>
      {label}
    </a>
  );
}
