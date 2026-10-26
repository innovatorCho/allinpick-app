"use client";

import { useFormStatus } from "react-dom";
import type { ReactNode } from "react";

/**
 * Drop-in `<button type="submit">` that shows a pending label while its
 * enclosing form's Server Action is in flight. Keeps the parent form/button
 * a plain server component — only this leaf needs `useFormStatus`.
 *
 * Added because a few actions here do a real network call to OliveYoung
 * (collection can take up to ~10s, e.g. when blocked and timing out) with
 * no prior visual feedback, which read as "nothing is happening" — this is
 * the fix.
 */
export function SubmitButton({
  children,
  pendingText,
  className,
}: {
  children: ReactNode;
  pendingText: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}
