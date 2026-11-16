/**
 * A prominent "please wait" box with a spinner, for the seconds-to-minutes
 * it takes to fetch a product's name and price from OliveYoung, so nobody
 * leaves thinking the page is stuck. The wording comes from site settings.
 */
export function CollectingNotice({ message, children }: { message: string; children?: React.ReactNode }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-start gap-3 rounded-xl border-2 border-sky-300 bg-sky-50 p-4 text-sky-900 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100"
    >
      <span
        aria-hidden
        className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-[3px] border-sky-200 border-t-sky-600 dark:border-sky-800 dark:border-t-sky-300"
      />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="whitespace-pre-line break-keep text-sm font-semibold leading-relaxed">{message}</p>
        {children}
      </div>
    </div>
  );
}
