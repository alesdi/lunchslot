"use client";

import { useId, useMemo } from "react";
import { isValidTz } from "@/lib/client";

export function TimezoneField({ value, onChange, disabled }: { value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const id = useId();
  const zones = useMemo(() => (typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []), []);
  const invalid = value.length > 0 && !isValidTz(value);
  return (
    <div className="flex-1">
      <label htmlFor={id} className="mb-2 block font-semibold">
        Your time zone
      </label>
      <input
        id={id}
        list={`${id}-zones`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={invalid}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 outline-none focus:border-ink aria-[invalid=true]:border-warn"
      />
      <datalist id={`${id}-zones`}>
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {invalid && <p className="mt-1 text-sm text-warn">Pick a time zone from the list, like Europe/Rome.</p>}
    </div>
  );
}
