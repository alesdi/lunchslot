"use client";

import { useId } from "react";

export function NameField({
  value,
  onChange,
  disabled,
  label = "Your name",
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  label?: string;
}) {
  const id = useId();
  const own = label === "Your name";
  return (
    <div className="flex-1">
      <label htmlFor={id} className="mb-2 block font-semibold">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={40}
        autoComplete={own ? "given-name" : "off"}
        className="w-full rounded-lg border border-line bg-surface px-4 py-2.5 outline-none focus:border-ink"
      />
    </div>
  );
}

export function SubmitButton({
  busy,
  busyLabel = "Reading your availability…",
  disabled,
  children,
}: {
  busy: boolean;
  busyLabel?: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="w-full rounded-lg bg-yolk px-5 py-3 font-bold text-yolk-ink transition-opacity disabled:opacity-50 sm:w-auto"
    >
      {busy ? busyLabel : children}
    </button>
  );
}

export function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-warn">
      {error}
    </p>
  );
}
