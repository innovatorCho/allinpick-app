"use client";

import { useEffect, useState } from "react";
import { subscribePushAction, unsubscribePushAction } from "@/lib/actions/push-actions";

type State = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(padded);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function isIosBrowserTab(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return ios && !standalone;
}

/**
 * "이 기기에서 알림 받기" — subscribes this browser to price alerts by push
 * (lib/webPush.ts, public/sw.js). iPhone only allows push from a site added
 * to the home screen, so there it shows how to do that instead.
 */
export function PushSubscribeButton({
  vapidPublicKey,
  notice,
  iosNotice,
}: {
  vapidPublicKey: string;
  notice: string | null;
  iosNotice: string | null;
}) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setState(isIosBrowserTab() ? "ios-install" : "unsupported");
        return;
      }
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
        const existing = await registration.pushManager.getSubscription();
        if (Notification.permission === "denied") setState("denied");
        else setState(existing ? "on" : "off");
      } catch {
        setState("unsupported");
      }
    })();
  }, []);

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
        }));
      const result = await subscribePushAction(JSON.parse(JSON.stringify(subscription)), navigator.userAgent);
      if (result.error) setError(result.error);
      else setState("on");
    } catch {
      setError("알림을 켜지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await unsubscribePushAction(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setState("off");
    } catch {
      setError("알림을 끄지 못했어요. 잠시 후 다시 시도해주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  const buttonClass =
    "rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50";

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm dark:border-zinc-800 dark:bg-zinc-950">
      {state === "ios-install" ? (
        iosNotice && <p className="break-keep text-xs text-zinc-600 dark:text-zinc-400">{iosNotice}</p>
      ) : (
        <>
          {notice && <p className="break-keep text-xs text-zinc-600 dark:text-zinc-400">{notice}</p>}
          <div className="flex flex-wrap items-center gap-2">
            {state === "on" ? (
              <>
                <span className="text-xs font-medium text-emerald-600">🔔 이 기기에서 알림을 받고 있어요</span>
                <button
                  type="button"
                  onClick={turnOff}
                  disabled={busy}
                  className={`${buttonClass} border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800`}
                >
                  {busy ? "처리 중..." : "알림 끄기"}
                </button>
              </>
            ) : state === "denied" ? (
              <span className="break-keep text-xs text-zinc-500">
                이 브라우저에서 알림이 차단돼 있어요. 주소창 왼쪽의 사이트 설정에서 알림을 허용한 뒤 새로고침해주세요.
              </span>
            ) : (
              <button
                type="button"
                onClick={turnOn}
                disabled={busy}
                className={`${buttonClass} bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300`}
              >
                {busy ? "켜는 중..." : "🔔 이 기기에서 알림 받기"}
              </button>
            )}
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </>
      )}
    </div>
  );
}
