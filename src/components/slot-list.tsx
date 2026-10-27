"use client";

import { useState } from "react";
import type { Pick, Slot } from "@/lib/match";

const pickLabel = (pick: Pick, slot: Slot) =>
  pick === "attendance" ? (slot.everyone ? "Everyone can make it" : "Most people can make it") : pick === "balanced" ? "Balanced" : "Earliest convenient time";

function fmt(slot: Slot, tz: string) {
  const s = new Date(slot.start);
  const e = new Date(slot.end);
  const day = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(s);
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz }).formatRange(s, e);
  return { day, time };
}

const list = (names: string[]) => new Intl.ListFormat(undefined, { type: "conjunction" }).format(names);

/**
 * `total` counts only people with times in the range; `idle` names the rest, who are left out of the slots.
 * `required` names the people every slot includes. `range` is the searched range mid-sentence, like "next 7 days".
 */
export function SlotList({
  slots,
  total,
  idle,
  required,
  tz,
  range,
}: {
  slots: Slot[];
  total: number;
  idle: string[];
  required: string[];
  tz: string;
  range: string;
}) {
  // Highlight slots that weren't there on the previous render.
  const keys = slots.map((s) => s.start).join("|");
  const [prevKeys, setPrevKeys] = useState(keys);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  if (keys !== prevKeys) {
    const before = new Set(prevKeys.split("|"));
    setPrevKeys(keys);
    setFresh(new Set(slots.map((s) => s.start).filter((k) => !before.has(k))));
  }

  // Required people without times get their own message, below.
  const idleOthers = idle.filter((n) => !required.includes(n));
  const idleNote = idleOthers.length > 0 && (
    <p className="mt-4 text-sm text-warn">
      {list(idleOthers)} {idleOthers.length === 1 ? "has" : "have"} no times in the {range}, so they aren&apos;t counted. Look further
      ahead, or ask them to update their availability.
    </p>
  );

  if (total + idle.length < 2) {
    return (
      <p className="rounded-lg border border-dashed border-line px-5 py-6 text-muted">
        Suggestions appear once a second person adds their availability. Copy the link and send it over.
      </p>
    );
  }
  if (slots.length === 0) {
    const idleRequired = required.filter((n) => idle.includes(n));
    return (
      <>
        <p className="rounded-lg border border-dashed border-line px-5 py-6 text-muted">
          {idleRequired.length > 0
            ? `${list(idleRequired)} must attend but ${idleRequired.length === 1 ? "has" : "have"} no times in the ${range}.`
            : required.length > 0
              ? `No time in the ${range} works for ${required.length === 1 ? `${required[0]} and anyone else` : list(required)}.`
              : `No time works for two or more people in the ${range}.`}{" "}
          {required.length > 0
            ? "Look further ahead, ask people to widen their availability, or require fewer people."
            : "Look further ahead, or ask people to widen their availability."}
        </p>
        {idleNote}
      </>
    );
  }

  return (
    <>
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
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Why this time">
                {slot.picks.map((pick) => (
                  <li
                    key={pick}
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${best ? "bg-yolk-ink text-yolk" : "border border-line text-ink"}`}
                  >
                    {pickLabel(pick, slot)}
                  </li>
                ))}
              </ul>
              <div className={best ? "font-semibold" : "text-muted"}>{day}</div>
              <div className={`font-extrabold tracking-tight ${best ? "text-4xl sm:text-5xl" : "text-2xl"}`}>{time}</div>
              {/* The attendance badge already says when everyone can make it. */}
              {!(slot.everyone && slot.picks.includes("attendance")) && (
                <div className={`mt-2 text-sm ${best ? "" : "text-muted"}`}>
                  {slot.everyone ? (
                    "Everyone can make it"
                  ) : (
                    <>
                      {slot.available.length} of {total} can make it. Missing: {slot.missing.join(", ")}
                    </>
                  )}
                </div>
              )}
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
      {idleNote}
    </>
  );
}
