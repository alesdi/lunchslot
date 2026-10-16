"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

const TIP =
  "Everyone sends their availability however they like, and an AI slices the week into the slot that works for all of you. It doesn't eat lunch, but it will defend yours.";

// Six slices like a clock face, centred on (21, 21). The first one (12 to 2 o'clock) is the picked slot.
const C = 21;
const R = 16;
function sector(i: number, r: number) {
  const at = (deg: number) => {
    const t = (deg * Math.PI) / 180;
    return `${(C + r * Math.sin(t)).toFixed(2)} ${(C - r * Math.cos(t)).toFixed(2)}`;
  };
  return `M${C} ${C}L${at(i * 60)}A${r} ${r} 0 0 1 ${at(i * 60 + 60)}Z`;
}
const CUTS = [0, 60, 120, 180, 240, 300].map((deg) => {
  const t = (deg * Math.PI) / 180;
  return `M${C} ${C}L${(C + (R + 1) * Math.sin(t)).toFixed(2)} ${(C - (R + 1) * Math.cos(t)).toFixed(2)}`;
});

function PizzaMark() {
  return (
    <svg viewBox="0 0 42 42" className="pizza size-9" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <g key={i}>
          <path d={sector(i, R)} fill="var(--crust)" />
          <path d={sector(i, R - 3.5)} fill="var(--yolk)" />
        </g>
      ))}
      <path d={CUTS.join("")} stroke="var(--paper)" strokeWidth="1.75" strokeLinecap="round" />
      <path className="pizza-slice" d={sector(0, R)} fill="var(--ink)" stroke="var(--paper)" strokeWidth="1.75" strokeLinejoin="round" />
    </svg>
  );
}

/** Header logo: the wordmark goes home, the pizza explains what Lunchslot does. */
export function Logo() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tipId = useId();

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={tipId}
        aria-label="What is Lunchslot?"
        data-open={open || undefined}
        className="logo-mark -m-1 cursor-pointer rounded-full p-1"
      >
        <PizzaMark />
      </button>
      <Link href="/" className="text-lg font-extrabold tracking-tight">
        lunchslot
      </Link>
      <div id={tipId} role="status" className="absolute top-full left-0 z-10 mt-3 w-72 max-w-[calc(100vw-2rem)]">
        {open && (
          <p className="bubble relative rounded-2xl border-2 border-ink bg-surface px-4 py-3 leading-snug font-semibold shadow-[4px_4px_0_var(--ink)]">
            {TIP}
          </p>
        )}
      </div>
    </div>
  );
}
