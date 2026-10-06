"use client";

import { useState } from "react";
import type { Slot } from "@/lib/match";

function fmt(slot: Slot, tz: string) {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(s);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).formatRange(s, e);
  return { day, time };
}

export function SlotList({ slots, total, tz }: { slots: Slot[]; total: number; tz: string }) {
  // Highlight slots that weren't there on the previous render.
  const keys = slots.map((s) => s.start).join("|");
  const [prevKeys, setPrevKeys] = useState(keys);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  if (keys !== prevKeys) {
    const before = new Set(prevKeys.split("|"));
    setPrevKeys(keys);
    setFresh(new Set(slots.map((s) => s.start).filter((k) => !before.has(k))));
  }

  if (total < 2) {
    return (
      <p className="rounded-lg border border-dashed border-line px-5 py-6 text-muted">
        Suggestions appear once a second person adds their availability. Copy the link and send it over.
      </p>
    );
  }
  if (slots.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-5 py-6 text-muted">
        No time works for two or more people yet in the next three weeks. Ask people to widen their availability.
      </p>
    );
  }

  return (
    <ol className="space-y-3">
      {slots.map((slot, i) => {
        const { day, time } = fmt(slot, tz);
        const best = i === 0;
        return (
          <li
            key={slot.start}
            className={`rounded-xl px-5 py-4 ${best ? "bg-yolk text-yolk-ink" : "border border-line bg-surface"} ${
              fresh.has(slot.start) ? "slot-arrive" : ""
            }`}
          >
            <div className={best ? "font-semibold" : "text-muted"}>{day}</div>
            <div className={`font-extrabold tracking-tight ${best ? "text-4xl sm:text-5xl" : "text-2xl"}`}>{time}</div>
            <div className={`mt-2 text-sm ${best ? "" : "text-muted"}`}>
              {slot.everyone ? (
                "Everyone can make it"
              ) : (
                <>
                  {slot.available.length} of {total} can make it. Missing: {slot.missing.join(", ")}
                </>
              )}
            </div>
            {slot.reasons.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-sm">
                {slot.reasons.map((r) => (
                  <li key={r.text} className={r.tone === "warn" ? (best ? "font-semibold" : "text-warn") : best ? "" : "text-muted"}>
                    {r.tone === "warn" ? "Heads up: " : ""}
                    {r.text}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
