"use client";

import { useEffect, useRef, useState } from "react";
import type { CalendarMessage } from "@/lib/google-calendar";

/** The form's calendar state: nothing, a connection just made in the popup, or the one the entry already has. */
export type CalendarChoice = { kind: "none" } | { kind: "new"; grant: string } | { kind: "kept" };

export function ConnectCalendar({
  value,
  onChange,
  disabled,
}: {
  value: CalendarChoice;
  onChange: (c: CalendarChoice) => void;
  disabled?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const popup = useRef<Window | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent<CalendarMessage>) {
      if (e.origin !== location.origin || e.source !== popup.current || e.data?.type !== "lunchslot:calendar") return;
      popup.current = null;
      if (e.data.grant) onChange({ kind: "new", grant: e.data.grant });
      else if (e.data.error) setError(e.data.error);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [onChange]);

  function connect() {
    setError(null);
    const w = 500;
    const h = 650;
    popup.current = window.open(
      "/api/google/authorize",
      "lunchslot-google",
      `popup,width=${w},height=${h},left=${Math.round(screenX + (outerWidth - w) / 2)},top=${Math.round(screenY + (outerHeight - h) / 2)}`,
    );
    if (!popup.current) setError("Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.");
  }

  return (
    <div className="text-sm">
      {value.kind === "none" ? (
        <button
          type="button"
          onClick={connect}
          disabled={disabled}
          className="rounded-lg border border-line bg-surface px-4 py-2 font-semibold hover:border-ink disabled:opacity-50"
        >
          Connect Google Calendar
        </button>
      ) : (
        <p>
          <span className="font-semibold">Google Calendar connected.</span>{" "}
          <button
            type="button"
            onClick={() => onChange({ kind: "none" })}
            disabled={disabled}
            className="text-muted underline underline-offset-2 hover:text-ink"
          >
            Disconnect
          </button>
        </p>
      )}
      <p className="mt-2 text-muted">
        {value.kind === "none"
          ? "Lunchslot only sees when you're busy, never what your events are, and keeps it up to date until you remove your entry."
          : "Your busy times come from your calendar. Add anything it doesn't show above, like “afternoons only”."}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-warn">
          {error}
        </p>
      )}
    </div>
  );
}
