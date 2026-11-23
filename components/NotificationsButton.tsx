"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  loadMyNotificationsAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/lib/actions/notification-actions";
import type { UserNotificationItem } from "@/lib/domain/notifications";
import { formatDateTime } from "@/lib/format";

/** Links into the modal: batched Kakao alerts point at /my#notifications (lib/kakaoBatch.ts). */
const OPEN_HASH = "#notifications";

/**
 * Header bell with the unread count. Opens the user's notifications in a
 * modal (native <dialog>: Esc, focus and backdrop for free), loaded when
 * opened so other pages don't pay for the list.
 */
export function NotificationsButton({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [items, setItems] = useState<UserNotificationItem[] | null>(null);
  const [unread, setUnread] = useState(unreadCount);
  const [error, setError] = useState(false);
  const [loading, startLoading] = useTransition();
  const [, startMarking] = useTransition();
  // Something was marked read while open: refresh the server badge on close.
  const changed = useRef(false);

  // A new server count (after router.refresh or navigation) replaces the local one.
  const [serverCount, setServerCount] = useState(unreadCount);
  if (serverCount !== unreadCount) {
    setServerCount(unreadCount);
    setUnread(unreadCount);
  }

  const open = useCallback(() => {
    const dialog = ref.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setError(false);
    startLoading(async () => {
      try {
        const result = await loadMyNotificationsAction();
        setItems(result.items);
        setUnread(result.unread);
      } catch {
        setError(true);
      }
    });
  }, []);

  useEffect(() => {
    const openFromHash = () => {
      if (window.location.hash !== OPEN_HASH) return;
      // Drop the hash so closing and reloading doesn't reopen it.
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
      open();
    };
    openFromHash();
    window.addEventListener("hashchange", openFromHash);
    return () => window.removeEventListener("hashchange", openFromHash);
  }, [open]);

  function close() {
    ref.current?.close();
  }

  function handleClosed() {
    if (changed.current) {
      changed.current = false;
      router.refresh();
    }
  }

  function markRead(id: number) {
    setItems((list) => list?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? null);
    setUnread((u) => Math.max(0, u - 1));
    changed.current = true;
    startMarking(() => markNotificationReadAction(id));
  }

  function markAllRead() {
    setItems((list) => list?.map((n) => ({ ...n, isRead: true })) ?? null);
    setUnread(0);
    changed.current = true;
    startMarking(() => markAllNotificationsReadAction());
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        aria-label={unread > 0 ? `알림 ${unread}건 안 읽음` : "알림"}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      >
        <svg aria-hidden width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[10px] font-bold leading-[18px] text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      <dialog
        ref={ref}
        onClose={handleClosed}
        onClick={(e) => e.target === e.currentTarget && close()}
        aria-labelledby="notifications-title"
        className="m-auto flex max-h-[min(40rem,calc(100dvh-2rem))] w-[min(28rem,calc(100%-2rem))] flex-col rounded-2xl bg-white p-0 text-zinc-900 shadow-xl backdrop:bg-black/40 not-open:hidden dark:bg-zinc-900 dark:text-zinc-100"
      >
        <div className="flex items-center justify-between gap-2 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 id="notifications-title" className="text-base font-semibold">
            알림{unread > 0 && <span className="ml-1 text-sm font-normal text-red-600">안 읽음 {unread}건</span>}
          </h2>
          <div className="flex items-center gap-1">
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              >
                모두 읽음
              </button>
            )}
            <button
              type="button"
              onClick={close}
              aria-label="닫기"
              className="flex h-8 w-8 items-center justify-center rounded-full text-lg text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
          {error ? (
            <p className="py-8 text-center text-sm text-zinc-500">알림을 불러오지 못했어요. 잠시 후 다시 열어주세요.</p>
          ) : items == null || (loading && items.length === 0) ? (
            <p className="py-8 text-center text-sm text-zinc-500">불러오는 중...</p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-zinc-500">받은 알림이 없습니다.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={
                    n.isRead
                      ? "rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950"
                      : "rounded-lg border border-blue-300 bg-blue-50 p-3 text-sm dark:border-blue-800 dark:bg-blue-950"
                  }
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      {!n.isRead && <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-600" aria-hidden />}
                      <Link
                        href={`/product/${n.productId}`}
                        onClick={() => {
                          if (!n.isRead) markRead(n.id);
                          close();
                        }}
                        className="truncate font-medium hover:underline"
                      >
                        {n.productName ?? n.productId}
                      </Link>
                    </div>
                    <span className="flex-shrink-0 text-xs text-zinc-400">{formatDateTime(n.createdAt)}</span>
                  </div>
                  <p className="mt-1 break-keep text-zinc-600 dark:text-zinc-400">{n.message}</p>
                  {!n.isRead && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="mt-2 rounded-lg border border-blue-300 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300 dark:hover:bg-blue-900"
                    >
                      읽음으로 표시
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-200 px-4 py-2.5 text-center dark:border-zinc-800">
          <Link
            href="/my#alert-settings"
            onClick={close}
            className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
          >
            카카오톡·기기 알림 설정 →
          </Link>
        </div>
      </dialog>
    </>
  );
}
