"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

/**
 * A centered dialog for messages a shopper must not miss (login required,
 * invalid link, failed save), instead of a small red line under a form.
 * Uses the native <dialog>, so Esc, focus and the backdrop come for free.
 */
export function MessageModal({
  open,
  message,
  onClose,
  loginLink = false,
}: {
  open: boolean;
  message: string;
  onClose: () => void;
  /** Adds a "로그인하기" button, for messages that ask the user to log in. */
  loginLink?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      // A click on the backdrop lands on the <dialog> itself, not its content.
      onClick={(e) => e.target === e.currentTarget && onClose()}
      className="m-auto w-[min(22rem,calc(100%-2rem))] rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 dark:bg-zinc-900 dark:text-zinc-100"
    >
      <div className="flex flex-col gap-5 p-5">
        <p className="whitespace-pre-line break-keep text-center text-sm leading-relaxed">{message}</p>
        <div className="flex gap-2">
          {loginLink && (
            <Link
              href="/login"
              onClick={onClose}
              className="flex-1 rounded-lg bg-zinc-900 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              로그인하기
            </Link>
          )}
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium ${
              loginLink
                ? "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
                : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            }`}
          >
            {loginLink ? "닫기" : "확인"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * Shows a form action's `error` in a MessageModal. Each submit returns a new
 * state object, so the same error shown again after being closed reopens it.
 */
export function ActionErrorModal({ state }: { state: { error?: string; needsLogin?: boolean } }) {
  const [closedFor, setClosedFor] = useState<object | null>(null);
  return (
    <MessageModal
      open={Boolean(state.error) && closedFor !== state}
      message={state.error ?? ""}
      loginLink={state.needsLogin}
      onClose={() => setClosedFor(state)}
    />
  );
}
